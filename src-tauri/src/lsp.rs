//! Minimal Language Server Protocol client plumbing (#670).
//!
//! Only the parts the agent needs: start a server per workspace, send framed
//! JSON-RPC, and stream `publishDiagnostics` back.  The framing lives in
//! [`Framer`], which is deliberately free of Tauri so it can be unit-tested
//! without WebKitGTK.

use std::collections::HashMap;
use std::io::{BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// Incremental `Content-Length` parser.
///
/// A chunk may end mid-header or mid-body, and one chunk may hold several
/// messages; both happen routinely with a real server.
#[derive(Default)]
pub struct Framer {
    buf: Vec<u8>,
}

impl Framer {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    /// Feed bytes, get back every complete message body (JSON text).
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        loop {
            let Some(header_end) = find(&self.buf, b"\r\n\r\n") else {
                return out;
            };
            let header = String::from_utf8_lossy(&self.buf[..header_end]).to_string();
            let Some(len) = content_length(&header) else {
                // Unparseable header: drop through it so a bad frame cannot
                // wedge the stream forever.
                self.buf.drain(..header_end + 4);
                continue;
            };
            let body_start = header_end + 4;
            if self.buf.len() < body_start + len {
                return out;
            }
            let body = self.buf[body_start..body_start + len].to_vec();
            self.buf.drain(..body_start + len);
            if let Ok(text) = String::from_utf8(body) {
                out.push(text);
            }
        }
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn content_length(header: &str) -> Option<usize> {
    header.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim().eq_ignore_ascii_case("content-length") {
            value.trim().parse().ok()
        } else {
            None
        }
    })
}

/// Wrap a JSON body in the LSP transport header.
pub fn frame(body: &str) -> String {
    format!("Content-Length: {}\r\n\r\n{}", body.len(), body)
}

struct Session {
    stdin: ChildStdin,
    child: Child,
}

static LSP_COUNTER: AtomicU64 = AtomicU64::new(1);

fn sessions() -> &'static Mutex<HashMap<u64, Session>> {
    static SESSIONS: std::sync::OnceLock<Mutex<HashMap<u64, Session>>> =
        std::sync::OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Servers the UI is allowed to launch.
///
/// The frontend passes the binary name, so without this check `lsp_start` would
/// be an arbitrary-exec primitive inside the webview.
const ALLOWED: [&str; 4] = [
    "typescript-language-server",
    "rust-analyzer",
    "pyright-langserver",
    "gopls",
];

pub fn is_allowed(command: &str) -> bool {
    std::path::Path::new(command)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| ALLOWED.contains(&n))
        .unwrap_or(false)
}

/// Allocate the id the caller will use for the event name.
pub fn next_id() -> u64 {
    LSP_COUNTER.fetch_add(1, Ordering::SeqCst)
}

/// Spawn a language server and stream its messages as `lsp_message_<id>` events.
pub fn start(
    id: u64,
    command: &str,
    args: &[String],
    cwd: Option<&str>,
    emit: impl Fn(String) + Send + 'static,
) -> Result<u64, String> {
    let mut cmd = Command::new(command);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start {command}: {e}"))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;

    std::thread::spawn(move || {
        let mut framer = Framer::new();
        let mut reader = BufReader::new(stdout);
        let mut chunk = [0u8; 8192];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    for body in framer.push(&chunk[..n]) {
                        emit(body);
                    }
                }
            }
        }
        let _ = reader.into_inner();
    });

    sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, Session { stdin, child });
    Ok(id)
}

pub fn send(id: u64, body: &str) -> Result<(), String> {
    let mut sessions = sessions().lock().map_err(|e| e.to_string())?;
    let session = sessions.get_mut(&id).ok_or("unknown language server")?;
    session
        .stdin
        .write_all(frame(body).as_bytes())
        .and_then(|_| session.stdin.flush())
        .map_err(|e| e.to_string())
}

pub fn stop(id: u64) {
    if let Ok(mut sessions) = sessions().lock() {
        if let Some(mut session) = sessions.remove(&id) {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framer_waits_for_a_complete_body() {
        let mut f = Framer::new();
        assert!(f.push(b"Content-Length: 7\r\n\r\n{\"a\"").is_empty());
        assert_eq!(f.push(b":1}"), vec!["{\"a\":1}".to_string()]);
    }

    #[test]
    fn framer_survives_a_split_header() {
        let mut f = Framer::new();
        assert!(f.push(b"Content-Len").is_empty());
        assert!(f.push(b"gth: 2\r\n\r").is_empty());
        assert_eq!(f.push(b"\n{}"), vec!["{}".to_string()]);
    }

    #[test]
    fn framer_parses_two_valid_messages() {
        let mut f = Framer::new();
        let both = format!("{}{}", frame("{\"id\":1}"), frame("{\"id\":2}"));
        assert_eq!(
            f.push(both.as_bytes()),
            vec!["{\"id\":1}".to_string(), "{\"id\":2}".to_string()]
        );
    }

    #[test]
    fn framer_is_case_insensitive_about_the_header() {
        let mut f = Framer::new();
        assert_eq!(
            f.push(b"content-length: 2\r\n\r\nok"),
            vec!["ok".to_string()]
        );
    }

    #[test]
    fn only_known_servers_may_be_started() {
        assert!(is_allowed("typescript-language-server"));
        assert!(is_allowed("/usr/bin/rust-analyzer"));
        assert!(!is_allowed("sh"));
        assert!(!is_allowed("/bin/sh"));
        assert!(!is_allowed(""));
    }

    #[test]
    fn frame_reports_the_byte_length() {
        assert_eq!(
            frame("{\"a\":\"é\"}"),
            "Content-Length: 10\r\n\r\n{\"a\":\"é\"}"
        );
    }
}
