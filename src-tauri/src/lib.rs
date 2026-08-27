use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::Duration;


// Multi-format document I/O modules (#140-#143) and browser-infra modules
// (#66, #68, #72, #73). Each is a self-contained module; pure logic is
// unit-tested via #[cfg(test)]; runtime-dependent paths are deferred.
mod document_convert; // #140 tiered converter + LibreOffice detection
mod ooxml;            // #141 OOXML template-fill + surgical edit
mod odf;              // #142 ODF edit (mimetype-stored-first)
mod pdf_tools;        // #143 PDF info/merge/split surface
mod ax;               // #73 AX-tree serializer + redaction
mod config_validation; // #66 config-invariant tests

#[derive(Serialize)]
struct CliOutput {
    stdout: String,
    stderr: String,
    exit_code: i32,
    timed_out: bool,
}

/// Run a shell command and return captured stdout/stderr.
/// Executed via `sh -c` on Unix/macOS, `cmd /C` on Windows.
/// Output is truncated to 10 000 chars (stdout) / 2 000 chars (stderr).
///
/// SECURITY MODEL: this executor is intentionally unrestricted at the Rust
/// layer — it runs whatever command it is given. The security boundary lives in
/// the frontend `run_shell_command` tool (services/tools.ts), which requires an
/// explicit user-approval modal for every command not already on the session
/// allow-list before it ever calls this command (the same approval-gated model
/// as Claude Code's shell tool). Do NOT rely on this function to filter
/// commands. See `run_cli_command` below for the alternative allow/deny-list
/// executor (not currently wired to the frontend).
#[tauri::command]
async fn run_cli(
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CliOutput, String> {
    // Builds and test suites commonly take longer than the old 30 s default.
    // The frontend sends an explicit bounded timeout for normal calls.
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(120_000));

    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(unix)]
        let mut cmd = {
            let mut c = std::process::Command::new("sh");
            c.arg("-c").arg(&command);
            c
        };
        #[cfg(windows)]
        let mut cmd = {
            let mut c = std::process::Command::new("cmd");
            c.arg("/C").arg(&command);
            c
        };

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        if let Some(ref dir) = cwd {
            cmd.current_dir(dir);
        }

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn command: {}", e))?;

        let pid = child.id();
        let (tx, rx) = mpsc::channel::<Result<std::process::Output, std::io::Error>>();

        std::thread::spawn(move || {
            let _ = tx.send(child.wait_with_output());
        });

        match rx.recv_timeout(timeout) {
            Ok(Ok(output)) => Ok(CliOutput {
                stdout: String::from_utf8_lossy(&output.stdout)
                    .chars()
                    .take(10_000)
                    .collect(),
                stderr: String::from_utf8_lossy(&output.stderr)
                    .chars()
                    .take(2_000)
                    .collect(),
                exit_code: output.status.code().unwrap_or(-1),
                timed_out: false,
            }),
            Ok(Err(e)) => Err(format!("Command error: {}", e)),
            Err(_) => {
                // Kill the process on timeout
                #[cfg(unix)]
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .status();
                #[cfg(windows)]
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/PID", &pid.to_string()])
                    .status();

                Ok(CliOutput {
                    stdout: String::new(),
                    stderr: format!(
                        "Command timed out after {}ms",
                        timeout.as_millis()
                    ),
                    exit_code: -1,
                    timed_out: true,
                })
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── MCP OAuth loopback redirect listener ────────────────────────────────────

#[derive(Serialize)]
struct OAuthRedirect {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[tauri::command]
async fn start_oauth_redirect_listener(port: u16) -> Result<OAuthRedirect, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = std::sync::mpsc::channel::<Result<OAuthRedirect, String>>();

        std::thread::spawn(move || {
            let _ = tx.send(handle_oauth_redirect(port));
        });

        // 5-minute window for the user to complete the OAuth flow in their browser
        match rx.recv_timeout(std::time::Duration::from_secs(300)) {
            Ok(result) => result,
            Err(_) => Err("OAuth redirect listener timed out after 5 minutes".to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn handle_oauth_redirect(port: u16) -> Result<OAuthRedirect, String> {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::Duration;

    let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
        .map_err(|e| format!("Failed to bind to port {}: {}", port, e))?;

    let (mut stream, _) = listener
        .accept()
        .map_err(|e| format!("Failed to accept connection: {}", e))?;

    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .ok();

    let mut buf = [0u8; 4096];
    let n = stream
        .read(&mut buf)
        .map_err(|e| format!("Failed to read request: {}", e))?;

    let request = String::from_utf8_lossy(&buf[..n]);

    // Parse "GET /callback?key=val&... HTTP/1.1"
    let query = request
        .lines()
        .next()
        .and_then(|line| line.split_once('?'))
        .and_then(|(_, rest)| rest.split_once(' '))
        .map(|(qs, _)| qs)
        .unwrap_or("");

    let params = parse_query(query);

    let html = "<html><body><h2>Authorization complete!</h2>\
                <p>You can close this tab and return to the app.</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    let _ = stream.write_all(response.as_bytes());

    Ok(OAuthRedirect {
        code: params.get("code").cloned(),
        state: params.get("state").cloned(),
        error: params.get("error").cloned(),
    })
}

fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    query
        .split('&')
        .filter(|s| !s.is_empty())
        .filter_map(|kv| {
            let (k, v) = kv.split_once('=')?;
            Some((k.to_string(), url_decode(v)))
        })
        .collect()
}

fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut result = String::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    result.push(byte as char);
                    i += 3;
                    continue;
                }
            }
        } else if bytes[i] == b'+' {
            result.push(' ');
        } else {
            result.push(bytes[i] as char);
        }
        i += 1;
    }
    result
}

use std::process::{Command, Child, ChildStdin, ChildStdout, ChildStderr};
use std::io::{Write, BufRead, BufReader};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use serde::Deserialize;
use reqwest::Client;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
struct McpStdioCommand {
    command: String,
    args: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliCommandRequest {
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    env: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliCommandResponse {
    success: bool,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    error: Option<String>,
    timed_out: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpHttpRequest {
    // Unused by the command body but historically part of the IPC payload. Kept
    // optional-with-default so callers that omit it (OpenAPI/image-gen HTTP
    // routing) still deserialize, while MCP HTTP sends `sessionId` (#435).
    #[serde(default)]
    session_id: String,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    auth_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct McpHttpResponse {
    success: bool,
    status: u16,
    headers: HashMap<String, String>,
    body: String,
    error: Option<String>,
}

#[derive(Debug)]
struct McpHttpSession {
    url: String,
    auth_token: Option<String>,
    client: Client,
    sender: mpsc::Sender<McpHttpResponse>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpStdioResponse {
    success: bool,
    message: String,
    session_id: Option<String>,
}

struct McpProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    stderr: BufReader<ChildStderr>,
    pending_requests: HashMap<u32, tauri::async_runtime::Sender<Result<String, String>>>, 
    next_request_id: u32,
}

lazy_static::lazy_static! {
    static ref MCP_PROCESSES: Arc<Mutex<HashMap<String, McpProcess>>> = 
        Arc::new(Mutex::new(HashMap::new()));
    
    static ref CLI_ALLOWLIST: Arc<Mutex<Vec<String>>> = 
        Arc::new(Mutex::new(vec![
            "echo".to_string(),
            "ls".to_string(),
            "dir".to_string(),
            "pwd".to_string(),
            "date".to_string(),
            "whoami".to_string(),
        ]));
    
    static ref CLI_DENYLIST: Arc<Mutex<Vec<String>>> = 
        Arc::new(Mutex::new(vec![
            "rm".to_string(),
            "del".to_string(),
            "mv".to_string(),
            "cp".to_string(),
            "chmod".to_string(),
            "sudo".to_string(),
            "shutdown".to_string(),
            "reboot".to_string(),
        ]));
    
    static ref MCP_HTTP_CLIENT: Arc<Mutex<Option<Client>>> = 
        Arc::new(Mutex::new(None));
    
    static ref MCP_SESSIONS: Arc<Mutex<HashMap<String, McpHttpSession>>> = 
        Arc::new(Mutex::new(HashMap::new()));
}

#[tauri::command]
async fn mcp_stdio_spawn(
    session_id: String,
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
) -> Result<McpStdioResponse, String> {
    let mut processes = MCP_PROCESSES.lock().map_err(|e| e.to_string())?;

    if processes.contains_key(&session_id) {
        return Ok(McpStdioResponse {
            success: false,
            message: format!("Session {} already exists", session_id),
            session_id: Some(session_id),
        });
    }

    let mut cmd = Command::new(command);
    cmd.args(args);
    // Inject per-server environment variables (e.g. credential tokens) on top of
    // the inherited environment, so MCP servers like GitHub/GitLab/Jira authenticate.
    if let Some(env_vars) = env {
        for (key, value) in env_vars {
            cmd.env(key, value);
        }
    }
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    
    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let stdout = BufReader::new(child.stdout.take().ok_or("Failed to capture stdout")?);
    let stderr = BufReader::new(child.stderr.take().ok_or("Failed to capture stderr")?);
    
    let process = McpProcess {
        child,
        stdin,
        stdout,
        stderr,
        pending_requests: HashMap::new(),
        next_request_id: 1,
    };
    
    processes.insert(session_id.clone(), process);
    
    Ok(McpStdioResponse {
        success: true,
        message: format!("Process spawned with session ID: {}", session_id),
        session_id: Some(session_id),
    })
}

#[tauri::command]
async fn mcp_stdio_send(
    session_id: String,
    request: String,
) -> Result<McpStdioResponse, String> {
    let mut processes = MCP_PROCESSES.lock().map_err(|e| e.to_string())?;
    let process = processes.get_mut(&session_id).ok_or("Session not found")?;
    
    // Write request to stdin
    process.stdin.write_all(request.as_bytes())
        .map_err(|e| e.to_string())?;
    process.stdin.write_all(b"\n")
        .map_err(|e| e.to_string())?;
    process.stdin.flush()
        .map_err(|e| e.to_string())?;
    
    Ok(McpStdioResponse {
        success: true,
        message: "Request sent".to_string(),
        session_id: Some(session_id),
    })
}

#[tauri::command]
async fn mcp_stdio_read(
    session_id: String,
) -> Result<Option<String>, String> {
    let mut processes = MCP_PROCESSES.lock().map_err(|e| e.to_string())?;
    let process = processes.get_mut(&session_id).ok_or("Session not found")?;
    
    let mut line = String::new();
    match process.stdout.read_line(&mut line) {
        Ok(0) => Ok(None), // EOF
        Ok(_) => Ok(Some(line)),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn mcp_stdio_close(
    session_id: String,
) -> Result<McpStdioResponse, String> {
    let mut processes = MCP_PROCESSES.lock().map_err(|e| e.to_string())?;
    let mut process = processes.remove(&session_id).ok_or("Session not found")?;

    // Try to kill the process gracefully
    let _ = process.child.kill();
    
    Ok(McpStdioResponse {
        success: true,
        message: "Process terminated".to_string(),
        session_id: Some(session_id),
    })
}

#[tauri::command]
async fn mcp_http_request(
    request: McpHttpRequest,
) -> Result<McpHttpResponse, String> {
    // Initialize HTTP client if not already done. Scope the guard in a block so
    // it is definitively dropped before the `.await` below (std MutexGuard is !Send).
    let client = {
        let mut client_guard = MCP_HTTP_CLIENT.lock().map_err(|e| e.to_string())?;
        if client_guard.is_none() {
            *client_guard = Some(Client::new());
        }
        client_guard.as_ref().unwrap().clone()
    };

    // Build the request
    let mut req_builder = match request.method.as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url),
        "PUT" => client.put(&request.url),
        "DELETE" => client.delete(&request.url),
        "PATCH" => client.patch(&request.url),
        _ => client.post(&request.url), // default to POST
    };
    
    // Add headers
    for (key, value) in &request.headers {
        req_builder = req_builder.header(key, value);
    }
    
    // Add authorization if token is provided
    if let Some(token) = &request.auth_token {
        req_builder = req_builder.bearer_auth(token);
    }
    
    // Add body if provided
    if let Some(body) = &request.body {
        req_builder = req_builder.body(body.clone());
    }
    
    // Execute the request
    let response = req_builder.send().await.map_err(|e| e.to_string())?;

    // Capture status + headers BEFORE consuming the body (.text() moves response).
    let status = response.status();
    let mut response_headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value_str) = value.to_str() {
            response_headers.insert(key.to_string(), value_str.to_string());
        }
    }

    // Read the response body
    let body = response.text().await.map_err(|e| e.to_string())?;

    Ok(McpHttpResponse {
        success: status.is_success(),
        status: status.as_u16(),
        headers: response_headers,
        body,
        error: None,
    })
}

/// Fetch a URL and return its body as base64 (for binary responses like the
/// ComfyUI `/view` image endpoint, where `mcp_http_request`'s `.text()` body
/// would corrupt bytes and `btoa` would throw on out-of-Latin1 code points).
#[derive(Debug, Serialize)]
struct HttpBinaryResponse {
    success: bool,
    status: u16,
    body_base64: String,
    error: Option<String>,
}

/// Base64-encode raw bytes using standard base64 (no newlines/padding stripped).
/// Extracted so the encoding path used by `http_get_binary` is unit-testable.
fn bytes_to_base64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[tauri::command]
async fn http_get_binary(url: String) -> Result<HttpBinaryResponse, String> {
    let client = {
        let mut client_guard = MCP_HTTP_CLIENT.lock().map_err(|e| e.to_string())?;
        if client_guard.is_none() {
            *client_guard = Some(Client::new());
        }
        client_guard.as_ref().unwrap().clone()
    };
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(HttpBinaryResponse {
        success: status.is_success(),
        status: status.as_u16(),
        body_base64: bytes_to_base64(&bytes),
        error: None,
    })
}

/// Hardened CLI executor that enforces [`CLI_ALLOWLIST`]/[`CLI_DENYLIST`] before
/// running a command.
///
/// NOTE (#410): this is NOT currently wired to the frontend — the removal of
/// `CliToolWrapper` in #223 left the live agentic path on `run_cli` (which is
/// user-approval-gated; see its doc). This command and its allow/deny lists are
/// retained as an opt-in hardened alternative for callers that want static
/// command filtering instead of interactive approval. It stays registered so the
/// IPC contract remains available; re-point the `run_shell_command` tool at it
/// to switch to list-based enforcement.
#[tauri::command]
async fn run_cli_command(
    request: CliCommandRequest,
) -> Result<CliCommandResponse, String> {
    // Check command against allowlist/denylist. Scope the guards in a block so
    // they are dropped before the `.await` below (std MutexGuard is !Send).
    let command_name = request.command.split_whitespace().next().unwrap_or("").to_string();
    {
        let allowlist = CLI_ALLOWLIST.lock().map_err(|e| e.to_string())?;
        let denylist = CLI_DENYLIST.lock().map_err(|e| e.to_string())?;

        if denylist.contains(&command_name) {
            return Ok(CliCommandResponse {
                success: false,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                error: Some("Command is blocked by security policy".to_string()),
                timed_out: false,
            });
        }

        if !allowlist.is_empty() && !allowlist.contains(&command_name) {
            return Ok(CliCommandResponse {
                success: false,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                error: Some("Command not in allowlist".to_string()),
                timed_out: false,
            });
        }
    }

    let mut cmd = Command::new(&request.command);
    cmd.args(&request.args);
    
    if let Some(cwd) = &request.cwd {
        cmd.current_dir(cwd);
    }
    
    if let Some(env_vars) = &request.env {
        for (key, value) in env_vars {
            cmd.env(key, value);
        }
    }
    
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(30_000));

    // Spawn separate reader threads for stdout/stderr so we can return partial
    // output captured before a timeout (Bug 2 fix: return actual text, not a
    // byte-count). A mpsc channel signals when the process exits.
    tauri::async_runtime::spawn_blocking(move || {
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => return Err(e.to_string()),
        };
        let pid = child.id();

        // Move piped stdio handles into reader threads that accumulate output.
        let stdout_buf = Arc::new(Mutex::new(String::new()));
        let stderr_buf = Arc::new(Mutex::new(String::new()));

        let out_buf = Arc::clone(&stdout_buf);
        let err_buf = Arc::clone(&stderr_buf);

        let child_stdout = child.stdout.take().expect("stdout piped");
        let child_stderr = child.stderr.take().expect("stderr piped");

        std::thread::spawn(move || {
            use std::io::Read;
            let mut s = String::new();
            let mut r = BufReader::new(child_stdout);
            let _ = r.read_to_string(&mut s);
            if let Ok(mut g) = out_buf.lock() { *g = s; }
        });
        std::thread::spawn(move || {
            use std::io::Read;
            let mut s = String::new();
            let mut r = BufReader::new(child_stderr);
            let _ = r.read_to_string(&mut s);
            if let Ok(mut g) = err_buf.lock() { *g = s; }
        });

        let (tx, rx) = mpsc::channel::<Result<std::process::ExitStatus, std::io::Error>>();
        std::thread::spawn(move || {
            let _ = tx.send(child.wait());
        });

        match rx.recv_timeout(timeout) {
            Ok(Ok(status)) => {
                // Reader threads may still be draining; give them a brief moment.
                std::thread::sleep(Duration::from_millis(50));
                let stdout = stdout_buf.lock().map(|g| g.chars().take(10_000).collect::<String>()).unwrap_or_default();
                let stderr = stderr_buf.lock().map(|g| g.chars().take(2_000).collect::<String>()).unwrap_or_default();
                Ok(CliCommandResponse {
                    success: status.success(),
                    exit_code: status.code(),
                    stdout,
                    stderr,
                    error: None,
                    timed_out: false,
                })
            },
            Ok(Err(e)) => Err(e.to_string()),
            Err(_) => {
                // Kill the process; reader threads will exit as pipes close.
                #[cfg(unix)]
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .status();
                #[cfg(windows)]
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/PID", &pid.to_string()])
                    .status();

                // Drain whatever partial output was captured before the kill.
                std::thread::sleep(Duration::from_millis(100));
                let stdout = stdout_buf.lock().map(|g| g.chars().take(10_000).collect::<String>()).unwrap_or_default();
                let stderr = stderr_buf.lock().map(|g| g.chars().take(2_000).collect::<String>()).unwrap_or_default();
                let timeout_note = format!("(timed out after {}ms)", timeout.as_millis());

                Ok(CliCommandResponse {
                    success: false,
                    exit_code: None,
                    stdout,
                    stderr: if stderr.is_empty() { timeout_note.clone() } else { format!("{}\n{}", timeout_note, stderr) },
                    error: Some(format!("Command timed out after {}ms", timeout.as_millis())),
                    timed_out: true,
                })
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn mcp_stdio_check(
    session_id: String,
) -> Result<bool, String> {
    let processes = MCP_PROCESSES.lock().map_err(|e| e.to_string())?;
    Ok(processes.contains_key(&session_id))
}

// ─── MLX acceleration (Apple Silicon) ────────────────────────────────────────
//
// MLX is Apple's array/ML framework for Apple Silicon. When the `mlx-lm` package
// is installed it ships `mlx_lm.server`, an OpenAI-compatible inference server.
// These commands detect availability and manage the server lifecycle so the GUI
// can route inference through MLX when present and cleanly fall back otherwise.

#[derive(Debug, Serialize)]
struct MlxAvailability {
    available: bool,
    apple_silicon: bool,
    mlx_lm: bool,
    python: Option<String>,
    version: Option<String>,
    reason: String,
}

struct MlxServer {
    child: Child,
    model: String,
    port: u16,
}

lazy_static::lazy_static! {
    static ref MLX_SERVER: Arc<Mutex<Option<MlxServer>>> = Arc::new(Mutex::new(None));
    /// Current workspace root — all filesystem commands validate paths against this.
    // Every folder the active project exposes (#492). roots[0] is the primary:
    // relative paths resolve against it and single-root callers use it. A path is
    // accepted when it lies inside ANY root, so a project can span several repos.
    static ref WORKSPACE_ROOTS: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
}

/// Find a usable python interpreter that can import mlx + mlx_lm.
/// Returns (python_bin, version) on success.
fn detect_mlx_python() -> Option<(String, String)> {
    for bin in ["python3", "python"] {
        let out = Command::new(bin)
            .args([
                "-c",
                "import mlx.core, mlx_lm; print(getattr(mlx_lm, '__version__', 'unknown'))",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                let version = String::from_utf8_lossy(&o.stdout).trim().to_string();
                return Some((bin.to_string(), version));
            }
        }
    }
    None
}

#[tauri::command]
async fn check_mlx_available() -> Result<MlxAvailability, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let apple_silicon =
            std::env::consts::OS == "macos" && std::env::consts::ARCH == "aarch64";

        if !apple_silicon {
            return MlxAvailability {
                available: false,
                apple_silicon: false,
                mlx_lm: false,
                python: None,
                version: None,
                reason: "MLX requires Apple Silicon (macOS, aarch64).".to_string(),
            };
        }

        match detect_mlx_python() {
            Some((python, version)) => MlxAvailability {
                available: true,
                apple_silicon: true,
                mlx_lm: true,
                python: Some(python),
                version: Some(version),
                reason: "MLX and mlx-lm are available.".to_string(),
            },
            None => MlxAvailability {
                available: false,
                apple_silicon: true,
                mlx_lm: false,
                python: None,
                version: None,
                reason: "mlx-lm not found. Install with: pip install mlx-lm".to_string(),
            },
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
struct MlxServerStatus {
    running: bool,
    model: Option<String>,
    port: Option<u16>,
}

#[tauri::command]
async fn mlx_start_server(model: String, port: u16) -> Result<MlxServerStatus, String> {
    // If a server is already running with the same model+port, keep it.
    {
        let guard = MLX_SERVER.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = guard.as_ref() {
            if existing.model == model && existing.port == port {
                return Ok(MlxServerStatus {
                    running: true,
                    model: Some(existing.model.clone()),
                    port: Some(existing.port),
                });
            }
        }
    }

    // Stop any existing server first.
    {
        let mut guard = MLX_SERVER.lock().map_err(|e| e.to_string())?;
        if let Some(mut old) = guard.take() {
            let _ = old.child.kill();
        }
    }

    let (python, _version) =
        detect_mlx_python().ok_or_else(|| "mlx-lm not available".to_string())?;

    let child = Command::new(&python)
        .args([
            "-m",
            "mlx_lm.server",
            "--model",
            &model,
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start mlx_lm.server: {}", e))?;

    let mut guard = MLX_SERVER.lock().map_err(|e| e.to_string())?;
    *guard = Some(MlxServer {
        child,
        model: model.clone(),
        port,
    });

    Ok(MlxServerStatus {
        running: true,
        model: Some(model),
        port: Some(port),
    })
}

#[tauri::command]
async fn mlx_stop_server() -> Result<MlxServerStatus, String> {
    let mut guard = MLX_SERVER.lock().map_err(|e| e.to_string())?;
    if let Some(mut server) = guard.take() {
        let _ = server.child.kill();
    }
    Ok(MlxServerStatus {
        running: false,
        model: None,
        port: None,
    })
}

#[tauri::command]
async fn mlx_server_status() -> Result<MlxServerStatus, String> {
    let mut guard = MLX_SERVER.lock().map_err(|e| e.to_string())?;
    if let Some(server) = guard.as_mut() {
        // Reap and check liveness.
        match server.child.try_wait() {
            Ok(Some(_)) => {
                // Process exited.
                let exited = guard.take();
                drop(exited);
                Ok(MlxServerStatus {
                    running: false,
                    model: None,
                    port: None,
                })
            }
            _ => Ok(MlxServerStatus {
                running: true,
                model: Some(server.model.clone()),
                port: Some(server.port),
            }),
        }
    } else {
        Ok(MlxServerStatus {
            running: false,
            model: None,
            port: None,
        })
    }
}

// ─── Secret storage: OS keychain with an encrypted-file fallback ─────────────
//
// Primary: the cross-platform `keyring` crate — macOS Keychain, Windows
// Credential Manager, Linux Secret Service. Fallback (no OS secret store, e.g.
// headless Linux): an AES-256-GCM encrypted file in the app data dir, with the
// 32-byte key in a sibling 0600 file. Plaintext secrets never touch disk.

use aes_gcm::{Aes256Gcm, Nonce, Key};
use aes_gcm::aead::{Aead, KeyInit, OsRng, AeadCore};

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}
fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 { return None; }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

fn secret_fallback_dir(_app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    // In Tauri v1, use dirs-next for app data directory
    let dir = dirs_next::data_dir()
        .ok_or("Could not find data directory")?
        .join("ollama-gui");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn restrict_perms(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

fn secret_fallback_key(app: &tauri::AppHandle) -> Result<Vec<u8>, String> {
    let path = secret_fallback_dir(app)?.join("secrets.key");
    if let Ok(s) = std::fs::read_to_string(&path) {
        if let Some(k) = hex_decode(s.trim()) {
            if k.len() == 32 { return Ok(k); }
        }
    }
    let key = Aes256Gcm::generate_key(&mut OsRng);
    std::fs::write(&path, hex_encode(key.as_slice())).map_err(|e| e.to_string())?;
    restrict_perms(&path);
    Ok(key.to_vec())
}

fn secret_fallback_load(app: &tauri::AppHandle) -> HashMap<String, String> {
    match secret_fallback_dir(app) {
        Ok(dir) => std::fs::read_to_string(dir.join("secrets.enc"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

fn secret_fallback_save(app: &tauri::AppHandle, map: &HashMap<String, String>) -> Result<(), String> {
    let path = secret_fallback_dir(app)?.join("secrets.enc");
    std::fs::write(&path, serde_json::to_string(map).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    restrict_perms(&path);
    Ok(())
}

fn secret_entry_key(service: &str, key: &str) -> String {
    format!("{service}\u{0}{key}")
}

fn secret_fallback_set(app: &tauri::AppHandle, service: &str, key: &str, value: &str) -> Result<(), String> {
    let kbytes = secret_fallback_key(app)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&kbytes));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher.encrypt(&nonce, value.as_bytes()).map_err(|e| e.to_string())?;
    let mut map = secret_fallback_load(app);
    map.insert(secret_entry_key(service, key), format!("{}:{}", hex_encode(&nonce), hex_encode(&ct)));
    secret_fallback_save(app, &map)
}

fn secret_fallback_get(app: &tauri::AppHandle, service: &str, key: &str) -> Option<String> {
    let entry = secret_fallback_load(app).get(&secret_entry_key(service, key))?.clone();
    let (n, c) = entry.split_once(':')?;
    let kbytes = secret_fallback_key(app).ok()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&kbytes));
    let pt = cipher.decrypt(Nonce::from_slice(&hex_decode(n)?), hex_decode(c)?.as_ref()).ok()?;
    String::from_utf8(pt).ok()
}

fn secret_fallback_delete(app: &tauri::AppHandle, service: &str, key: &str) -> Result<(), String> {
    let mut map = secret_fallback_load(app);
    map.remove(&secret_entry_key(service, key));
    secret_fallback_save(app, &map)
}

#[tauri::command]
async fn secret_set(app: tauri::AppHandle, service: String, key: String, value: String) -> Result<(), String> {
    match keyring::Entry::new(&service, &key).and_then(|e| e.set_password(&value)) {
        Ok(_) => Ok(()),
        Err(_) => secret_fallback_set(&app, &service, &key, &value), // no OS keychain → encrypted file
    }
}

#[tauri::command]
async fn secret_get(app: tauri::AppHandle, service: String, key: String) -> Result<Option<String>, String> {
    match keyring::Entry::new(&service, &key).and_then(|e| e.get_password()) {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(secret_fallback_get(&app, &service, &key)),
        Err(_) => Ok(secret_fallback_get(&app, &service, &key)),
    }
}

#[tauri::command]
async fn secret_delete(_app: tauri::AppHandle, service: String, key: String) -> Result<(), String> {
    // Tauri v1: keyring delete_password() not available
    let _ = secret_fallback_delete(&_app, &service, &key);
    Ok(())
}

#[derive(Debug, Serialize)]
struct SystemMemory {
    total_bytes: u64,
    available_bytes: u64,
    apple_silicon: bool,
}

/// Total + available system RAM, for the model-fit indicator (cross-platform via sysinfo).
#[tauri::command]
async fn get_system_memory() -> Result<SystemMemory, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        SystemMemory {
            total_bytes: sys.total_memory(),
            available_bytes: sys.available_memory(),
            apple_silicon: std::env::consts::OS == "macos" && std::env::consts::ARCH == "aarch64",
        }
    })
    .await
    .map_err(|e| e.to_string())
}

// ─── Filesystem path validation (#550) ───────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PathCheck {
    exists: bool,
    is_dir: bool,
    readable: bool,
}

/// Pure metadata probe behind `path_exists` — split out so the unit tests can
/// call it without a Tauri runtime. `readable` mirrors whether `metadata()`
/// succeeds: a path we cannot stat is a path we cannot use.
fn check_path_metadata(path: &str) -> PathCheck {
    match std::fs::metadata(path) {
        Ok(meta) => PathCheck { exists: true, is_dir: meta.is_dir(), readable: true },
        Err(_) => PathCheck { exists: false, is_dir: false, readable: false },
    }
}

/// Validate a filesystem path from the backend (#550): the frontend used to
/// guess from strings; now the OS answers. Runs on a blocking thread because
/// `metadata()` on a stale network mount can stall.
#[tauri::command]
async fn path_exists(path: String) -> Result<PathCheck, String> {
    tauri::async_runtime::spawn_blocking(move || check_path_metadata(&path))
        .await
        .map_err(|e| e.to_string())
}

// ─── Terminal streaming commands (#87) ───────────────────────────────────────
//
// Spawns a shell command and streams stdout/stderr lines back to the frontend
// via Tauri events.  Each session gets a unique u64 id.  The frontend
// subscribes to `terminal_output_<id>` events; a final `{ done: true }` event
// signals completion.

static TERMINAL_SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Maps session_id → OS PID for kill support.
lazy_static::lazy_static! {
    static ref TERMINAL_PIDS: Arc<Mutex<HashMap<u64, u32>>>
        = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Serialize, Clone)]
struct TerminalLine {
    line: String,
    stream: String, // "stdout" | "stderr"
    done: bool,
}

#[tauri::command]
async fn terminal_run(
    command: String,
    cwd: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<u64, String> {
    let id = TERMINAL_SESSION_COUNTER.fetch_add(1, Ordering::SeqCst);
    let event_name = format!("terminal_output_{}", id);

    // Platform-appropriate shell: sh -c on Unix, cmd /C on Windows (#439).
    // Mirrors the run_cli command's cfg(unix/windows) split — without this,
    // the terminal panel fails on Windows where sh is not in PATH.
    #[cfg(unix)]
    let mut cmd = {
        let mut c = std::process::Command::new("sh");
        c.arg("-c").arg(&command);
        c
    };
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg(&command);
        c
    };
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    // Store the OS PID so terminal_kill can signal the process.
    let pid = child.id();
    TERMINAL_PIDS.lock().map_err(|e| e.to_string())?.insert(id, pid);

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    // Tauri v1: emit_all() not available - using direct callback instead
    // let app1 = app_handle.clone();
    // let event1 = event_name.clone();
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            // Tauri v1: emit_all(&event, payload) not available
            // Using direct callback approach
            println!("stdout: {}", line);
        }
    });

    // let app2 = app_handle.clone();
    // let event2 = event_name.clone();
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            println!("stderr: {}", line);
        }
    });

    // Tauri v1: emit_all() not available
    // let pids_ref = Arc::clone(&TERMINAL_PIDS);
    // let app3 = app_handle.clone();
    // let event3 = event_name.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        // pids_ref.lock().ok().map(|mut m| m.remove(&id));
        println!("terminal done");
    });

    Ok(id)
}

/// Kill a terminal session by sending SIGKILL to the shell process.
#[tauri::command]
fn terminal_kill(session_id: u64) -> Result<(), String> {
    let pid = {
        let mut pids = TERMINAL_PIDS.lock().map_err(|e| e.to_string())?;
        pids.remove(&session_id)
    };
    if let Some(pid) = pid {
        #[cfg(unix)]
        {
            let _ = std::process::Command::new("kill")
                .args(["-9", &pid.to_string()])
                .output();
        }
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .output();
        }
    }
    Ok(())
}

/// Check whether an executable is available on PATH (e.g. docker, uvx, npx).
/// Used by connector UX to detect prerequisites without a shell plugin.
// ─── Filesystem commands (#82) ───────────────────────────────────────────────
//
// All file operations are restricted to the user-chosen workspace root.
// Paths are canonicalized before comparison to prevent path-traversal attacks.

#[derive(Serialize)]
struct FsDirEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified_ms: Option<u64>,
}

/// Resolve `path` and verify it is inside the workspace root.
/// Returns the canonical absolute path on success.
fn resolve_workspace_path(path: &str) -> Result<PathBuf, String> {
    let roots = WORKSPACE_ROOTS.lock().map_err(|e| e.to_string())?;
    let primary = roots
        .first()
        .ok_or_else(|| "No workspace root set. Call set_workspace_root first.".to_string())?;
    let candidate = PathBuf::from(path);
    // Resolve to absolute; the file doesn't have to exist yet for writes.
    // Relative paths are interpreted against the primary root.
    let abs = if candidate.is_absolute() {
        candidate.clone()
    } else {
        primary.join(&candidate)
    };
    // Normalize without requiring existence (for new files)
    let normalized = normalize_path(&abs);
    // A project may span several repositories (#492): accept any configured root.
    if !roots.iter().any(|r| normalized.starts_with(r)) {
        return Err(format!("Path '{}' is outside the workspace root(s).", path));
    }
    Ok(normalized)
}

/// Lexically normalize a path (resolve `..` without hitting the filesystem).
fn normalize_path(path: &PathBuf) -> PathBuf {
    let mut parts: Vec<&std::ffi::OsStr> = Vec::new();
    for component in path.components() {
        use std::path::Component::*;
        match component {
            ParentDir => { parts.pop(); }
            CurDir => {}
            c => parts.push(c.as_os_str()),
        }
    }
    parts.iter().collect()
}

#[tauri::command]
fn set_workspace_root(path: String) -> Result<(), String> {
    set_workspace_roots(vec![path])
}

/// Replace the set of folders the agent may touch (#492). The first entry is
/// the primary root (relative paths resolve against it). Every path must be an
/// existing directory; an empty list clears the workspace.
#[tauri::command]
fn set_workspace_roots(paths: Vec<String>) -> Result<(), String> {
    let mut canonical: Vec<PathBuf> = Vec::with_capacity(paths.len());
    for path in &paths {
        let p = PathBuf::from(path);
        if !p.is_dir() {
            return Err(format!("'{}' is not a directory or does not exist.", path));
        }
        let c = p.canonicalize().map_err(|e| e.to_string())?;
        if !canonical.contains(&c) {
            canonical.push(c);
        }
    }
    let mut roots = WORKSPACE_ROOTS.lock().map_err(|e| e.to_string())?;
    *roots = canonical;
    Ok(())
}

/// The folders currently exposed to the agent, primary first (#492).
#[tauri::command]
fn get_workspace_roots() -> Result<Vec<String>, String> {
    let roots = WORKSPACE_ROOTS.lock().map_err(|e| e.to_string())?;
    Ok(roots.iter().map(|p| p.to_string_lossy().to_string()).collect())
}

/// Read a file, optionally a line range. `offset` is a 1-indexed start line and
/// `limit` a line count; omitting both returns the whole file (#422).
#[tauri::command]
async fn read_file(path: String, offset: Option<usize>, limit: Option<usize>) -> Result<String, String> {
    let abs = resolve_workspace_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let content = std::fs::read_to_string(&abs).map_err(|e| e.to_string())?;
        if offset.is_none() && limit.is_none() {
            return Ok(content);
        }
        let lines: Vec<&str> = content.lines().collect();
        let start = offset.unwrap_or(1).max(1).saturating_sub(1).min(lines.len());
        let end = match limit {
            Some(l) => start.saturating_add(l).min(lines.len()),
            None => lines.len(),
        };
        Ok(lines[start..end].join("\n"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    let abs = resolve_workspace_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&abs, &content).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<FsDirEntry>, String> {
    let abs = resolve_workspace_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let rd = std::fs::read_dir(&abs).map_err(|e| e.to_string())?;
        let mut entries: Vec<FsDirEntry> = rd
            .filter_map(|e| e.ok())
            .map(|e| {
                let meta = e.metadata().ok();
                let modified_ms = meta.as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64);
                FsDirEntry {
                    name: e.file_name().to_string_lossy().into_owned(),
                    path: e.path().to_string_lossy().into_owned(),
                    is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                    size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                    modified_ms,
                }
            })
            .collect();
        entries.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Surgical string-replacement edit. Errors if `old_string` is not found or
/// appears more than once (to avoid ambiguous replacements).
#[tauri::command]
async fn apply_edit(path: String, old_string: String, new_string: String) -> Result<(), String> {
    let abs = resolve_workspace_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let content = std::fs::read_to_string(&abs).map_err(|e| e.to_string())?;
        let count = content.matches(old_string.as_str()).count();
        if count == 0 {
            return Err("old_string not found in file.".to_string());
        }
        if count > 1 {
            return Err(format!("old_string found {} times — provide more context to make the match unique.", count));
        }
        let updated = content.replacen(old_string.as_str(), new_string.as_str(), 1);
        std::fs::write(&abs, &updated).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// Delete a file within the workspace (#397 — multi-file apply_patch delete op).
// Refuses to delete directories; the path must resolve inside the workspace root.
#[tauri::command]
async fn delete_file(path: String) -> Result<(), String> {
    let abs = resolve_workspace_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&abs).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            return Err("delete_file refuses to delete directories.".to_string());
        }
        std::fs::remove_file(&abs).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Code search: literal/regex grep + glob (#420) ────────────────────────────

/// Directories skipped during workspace-wide search/glob (noise + VCS + builds).
const SEARCH_SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "dist", "build", ".next", ".vite", ".turbo",
];

#[derive(serde::Serialize)]
struct SearchHit {
    /// Path relative to the workspace root, forward-slash separated.
    file: String,
    /// 1-indexed line number.
    line: u32,
    /// The matching line (trimmed to 400 chars).
    text: String,
}

/// Convert a path glob (`**`, `*`, `?`) into an anchored regex over
/// forward-slash relative paths. `**` matches across separators (and an
/// optional trailing `/`); `*` and `?` stay within a single path segment.
fn glob_to_regex(glob: &str) -> String {
    let bytes = glob.as_bytes();
    let mut re = String::from("^");
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        match c {
            '*' => {
                if i + 1 < bytes.len() && bytes[i + 1] == b'*' {
                    re.push_str(".*");
                    i += 1; // consume second '*'
                    if i + 1 < bytes.len() && bytes[i + 1] == b'/' {
                        i += 1; // consume the '/' so `**/` matches zero dirs too
                    }
                } else {
                    re.push_str("[^/]*");
                }
            }
            '?' => re.push_str("[^/]"),
            '.' | '+' | '(' | ')' | '|' | '^' | '$' | '{' | '}' | '[' | ']' | '\\' => {
                re.push('\\');
                re.push(c);
            }
            _ => re.push(c),
        }
        i += 1;
    }
    re.push('$');
    re
}

/// True if `dir_name` is a directory we should not descend into.
fn is_skip_dir(dir_name: &str) -> bool {
    SEARCH_SKIP_DIRS.contains(&dir_name)
}

/// Literal or regex search for `query` across text files in the workspace.
/// Returns structured file:line hits (relative paths), capped at `max_results`.
#[tauri::command]
async fn search_files(
    query: String,
    is_regex: Option<bool>,
    case_sensitive: Option<bool>,
    include_glob: Option<String>,
    max_results: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    // Walk EVERY configured root, not just the primary (#541). A project may
    // span several repositories; searching only roots[0] made symbols in the
    // others look nonexistent even though read_file on the same path worked.
    let roots = {
        let guard = WORKSPACE_ROOTS.lock().map_err(|e| e.to_string())?;
        if guard.is_empty() { return Err("No workspace root set.".to_string()); }
        guard.clone()
    };
    let max = max_results.unwrap_or(200).min(2000);
    let case_sensitive = case_sensitive.unwrap_or(false);
    let use_regex = is_regex.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let pattern = if use_regex { query.clone() } else { regex::escape(&query) };
        let matcher = regex::RegexBuilder::new(&pattern)
            .case_insensitive(!case_sensitive)
            .build()
            .map_err(|e| format!("Invalid pattern: {e}"))?;
        let include = match include_glob {
            Some(g) if !g.is_empty() => Some(
                regex::Regex::new(&glob_to_regex(&g)).map_err(|e| format!("Invalid include glob: {e}"))?,
            ),
            _ => None,
        };
        let mut hits: Vec<SearchHit> = Vec::new();
        // The cap applies across the combined walk, not per root.
        for (root_idx, root) in roots.iter().enumerate() {
            let walker = walkdir::WalkDir::new(root).into_iter().filter_entry(|e| {
                !(e.file_type().is_dir()
                    && e.file_name().to_str().map(is_skip_dir).unwrap_or(false))
            });
            for entry in walker {
                let entry = match entry { Ok(e) => e, Err(_) => continue };
                if !entry.file_type().is_file() { continue; }
                let rel = entry
                    .path()
                    .strip_prefix(root)
                    .unwrap_or(entry.path())
                    .to_string_lossy()
                    .replace('\\', "/");
                if let Some(ref inc) = include {
                    if !inc.is_match(&rel) { continue; }
                }
                // Primary root keeps workspace-relative paths (unchanged for
                // single-root projects); secondary roots report ABSOLUTE paths,
                // which resolve_workspace_path also accepts — so every hit can
                // be fed straight back into read_file regardless of its repo.
                let reported = if root_idx == 0 {
                    rel
                } else {
                    entry.path().to_string_lossy().replace('\\', "/")
                };
                let content = match std::fs::read_to_string(entry.path()) { Ok(c) => c, Err(_) => continue };
                for (idx, line) in content.lines().enumerate() {
                    if matcher.is_match(line) {
                        hits.push(SearchHit {
                            file: reported.clone(),
                            line: (idx as u32) + 1,
                            text: line.chars().take(400).collect(),
                        });
                        if hits.len() >= max { return Ok(hits); }
                    }
                }
            }
        }
        Ok(hits)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Resolve a path glob (e.g. `src/**/*.ts`) to matching workspace-relative
/// file paths, capped at `max_results`.
#[tauri::command]
async fn glob_files(pattern: String, max_results: Option<usize>) -> Result<Vec<String>, String> {
    // Every configured root, not just the primary (#541) — see search_files.
    let roots = {
        let guard = WORKSPACE_ROOTS.lock().map_err(|e| e.to_string())?;
        if guard.is_empty() { return Err("No workspace root set.".to_string()); }
        guard.clone()
    };
    let max = max_results.unwrap_or(500).min(5000);
    tauri::async_runtime::spawn_blocking(move || {
        let re = regex::Regex::new(&glob_to_regex(&pattern)).map_err(|e| format!("Invalid glob: {e}"))?;
        let mut out: Vec<String> = Vec::new();
        'roots: for (root_idx, root) in roots.iter().enumerate() {
            let walker = walkdir::WalkDir::new(root).into_iter().filter_entry(|e| {
                !(e.file_type().is_dir()
                    && e.file_name().to_str().map(is_skip_dir).unwrap_or(false))
            });
            for entry in walker {
                let entry = match entry { Ok(e) => e, Err(_) => continue };
                if !entry.file_type().is_file() { continue; }
                let rel = entry
                    .path()
                    .strip_prefix(root)
                    .unwrap_or(entry.path())
                    .to_string_lossy()
                    .replace('\\', "/");
                // The glob is matched against the root-relative path in every
                // repo, so `src/**/*.ts` means the same thing in each; only the
                // REPORTED path differs (absolute for secondary roots).
                if re.is_match(&rel) {
                    out.push(if root_idx == 0 {
                        rel
                    } else {
                        entry.path().to_string_lossy().replace('\\', "/")
                    });
                    if out.len() >= max { break 'roots; }
                }
            }
        }
        out.sort();
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── File operations: move/copy/mkdir (#421) ──────────────────────────────────

/// Move/rename a file within the workspace. Creates the destination's parent
/// directory as needed. Both paths must resolve inside the workspace root.
#[tauri::command]
async fn move_path(from: String, to: String) -> Result<(), String> {
    let abs_from = resolve_workspace_path(&from)?;
    let abs_to = resolve_workspace_path(&to)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = abs_to.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&abs_from, &abs_to).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copy a file within the workspace (files only). Creates the destination's
/// parent directory as needed.
#[tauri::command]
async fn copy_path(from: String, to: String) -> Result<(), String> {
    let abs_from = resolve_workspace_path(&from)?;
    let abs_to = resolve_workspace_path(&to)?;
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&abs_from).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            return Err("copy_path does not support directories.".to_string());
        }
        if let Some(parent) = abs_to.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(&abs_from, &abs_to).map(|_| ()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create a directory (and any missing parents) within the workspace.
#[tauri::command]
async fn create_dir(path: String) -> Result<(), String> {
    let abs = resolve_workspace_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&abs).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── Git integration commands (#103) ─────────────────────────────────────────
//
// Thin wrappers around `git` subprocess calls. All operations are scoped to
// the `cwd` parameter and never accept arbitrary git flags — only the specific
// inputs each function needs.

fn run_git(args: &[&str], cwd: &str) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[derive(Serialize)]
struct GitStatus {
    staged: Vec<String>,
    unstaged: Vec<String>,
    untracked: Vec<String>,
}

#[tauri::command]
async fn git_status(cwd: String) -> Result<GitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let raw = run_git(&["status", "--porcelain"], &cwd)?;
        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        let mut untracked = Vec::new();
        for line in raw.lines() {
            if line.len() < 3 { continue; }
            let xy = &line[..2];
            let path = line[3..].to_string();
            let x = &xy[..1];
            let y = &xy[1..2];
            if x != " " && x != "?" { staged.push(path.clone()); }
            if y != " " && y != "?" { unstaged.push(path.clone()); }
            if xy == "??" { untracked.push(path.clone()); }
        }
        Ok(GitStatus { staged, unstaged, untracked })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct GitDiff {
    diff: String,
}

#[tauri::command]
async fn git_diff(cwd: String, file: Option<String>, staged: Option<bool>) -> Result<GitDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args: Vec<&str> = vec!["diff"];
        let staged_flag = "--cached";
        if staged.unwrap_or(false) { args.push(staged_flag); }
        if let Some(ref f) = file { args.push("--"); args.push(f.as_str()); }
        let diff = run_git(&args, &cwd)?;
        Ok(GitDiff { diff })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_stage(cwd: String, files: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args: Vec<&str> = vec!["add", "--"];
        for f in &files { args.push(f.as_str()); }
        run_git(&args, &cwd).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_unstage(cwd: String, files: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args: Vec<&str> = vec!["restore", "--staged", "--"];
        for f in &files { args.push(f.as_str()); }
        run_git(&args, &cwd).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct GitCommitResult {
    hash: String,
}

#[tauri::command]
async fn git_commit(cwd: String, message: String) -> Result<GitCommitResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_git(&["commit", "-m", &message], &cwd)?;
        let hash = run_git(&["rev-parse", "--short", "HEAD"], &cwd)?;
        Ok(GitCommitResult { hash: hash.trim().to_string() })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct GitLogEntry {
    hash: String,
    author: String,
    date: String,
    subject: String,
}

#[tauri::command]
async fn git_log(cwd: String, n: Option<usize>) -> Result<Vec<GitLogEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let limit = format!("-{}", n.unwrap_or(20));
        let raw = run_git(&["log", &limit, "--pretty=format:%H\x1f%an\x1f%ai\x1f%s"], &cwd)?;
        let entries = raw.lines()
            .filter(|l| !l.is_empty())
            .filter_map(|line| {
                let parts: Vec<&str> = line.splitn(4, '\x1f').collect();
                if parts.len() < 4 { return None; }
                Some(GitLogEntry {
                    hash: parts[0].chars().take(8).collect(),
                    author: parts[1].to_string(),
                    date: parts[2].to_string(),
                    subject: parts[3].to_string(),
                })
            })
            .collect();
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

// git_reset (#402) — revert the last agent auto-commit (Aider /undo parity).
#[tauri::command]
async fn git_reset(cwd: String, n: Option<usize>) -> Result<(), String> {
    let count = n.unwrap_or(1);
    if count == 0 {
        return Ok(());
    }
    let n_str = format!("HEAD~{}", count);
    tauri::async_runtime::spawn_blocking(move || {
        run_git(&["reset", "--hard", &n_str], &cwd)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─────────────────────────────────────────────────────────────────────────────
// M18 — Multi-format document I/O (#139-#145)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct DocumentContent {
    text: String,
    format: String,
    title: Option<String>,
    word_count: usize,
}

/// Collect text nodes inside `include_local` elements from XML bytes.
/// `paragraph_tags` emit a newline after they close.
fn extract_xml_text(
    xml_bytes: &[u8],
    include_local: &[&[u8]],
    paragraph_local: &[&[u8]],
) -> String {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_reader(xml_bytes);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut output = String::new();
    let mut depth: i32 = 0;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let loc = e.local_name();
                let l = loc.as_ref();
                if include_local.iter().any(|&t| t == l) {
                    depth += 1;
                }
            }
            Ok(Event::End(ref e)) => {
                let loc = e.local_name();
                let l = loc.as_ref();
                if include_local.iter().any(|&t| t == l) && depth > 0 {
                    depth -= 1;
                }
                if paragraph_local.iter().any(|&t| t == l) {
                    output.push('\n');
                }
            }
            Ok(Event::Text(ref e)) if depth > 0 => {
                if let Ok(t) = e.unescape().map_err(|e| format!("unescape error: {:?}", e)) {
                    output.push_str(&t);
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    output
}

fn read_zip_entry(path: &str, entry_name: &str) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut entry = zip.by_name(entry_name).map_err(|e| format!("{entry_name}: {e}"))?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

fn read_zip_entries_prefix(path: &str, prefix: &str) -> Result<Vec<Vec<u8>>, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|e| e.name().to_string()))
        .filter(|n| n.starts_with(prefix) && n.ends_with(".xml"))
        .collect();
    let mut results = Vec::new();
    for name in names {
        let mut entry = zip.by_name(&name).map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        results.push(buf);
    }
    Ok(results)
}

fn extract_docx_text(path: &str) -> Result<String, String> {
    let xml = read_zip_entry(path, "word/document.xml")?;
    // <w:t> holds text runs; <w:p> is a paragraph
    Ok(extract_xml_text(&xml, &[b"t"], &[b"p"]))
}

fn extract_xlsx_text(path: &str) -> Result<String, String> {
    // Shared strings file
    let ss_xml = read_zip_entry(path, "xl/sharedStrings.xml").unwrap_or_default();
    let shared = extract_xml_text(&ss_xml, &[b"t"], &[b"si"]);
    // Sheet data
    let sheets = read_zip_entries_prefix(path, "xl/worksheets/sheet")?;
    let mut out = shared;
    for s in sheets {
        out.push_str(&extract_xml_text(&s, &[b"v", b"t"], &[b"row"]));
    }
    Ok(out)
}

fn extract_pptx_text(path: &str) -> Result<String, String> {
    let slides = read_zip_entries_prefix(path, "ppt/slides/slide")?;
    let mut out = String::new();
    for s in slides {
        // <a:t> is DrawingML text; <a:p> is a paragraph
        out.push_str(&extract_xml_text(&s, &[b"t"], &[b"p"]));
        out.push('\n');
    }
    Ok(out)
}

fn extract_odt_text(path: &str) -> Result<String, String> {
    let xml = read_zip_entry(path, "content.xml")?;
    Ok(extract_xml_text(&xml, &[b"p", b"h", b"span"], &[b"p", b"h"]))
}

fn detect_format(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".docx") { "docx" }
    else if lower.ends_with(".xlsx") { "xlsx" }
    else if lower.ends_with(".pptx") { "pptx" }
    else if lower.ends_with(".odt") || lower.ends_with(".ods") || lower.ends_with(".odp") { "odt" }
    else if lower.ends_with(".pdf") { "pdf" }
    else if lower.ends_with(".md") || lower.ends_with(".markdown") { "markdown" }
    else { "text" }
}

#[tauri::command]
async fn document_read(path: String) -> Result<DocumentContent, String> {
    let path = resolve_workspace_path(&path)?;
    let path_str = path.to_str().ok_or("Invalid path")?;
    let format = detect_format(path_str);

    let text = match format {
        "docx" => extract_docx_text(path_str)?,
        "xlsx" => extract_xlsx_text(path_str)?,
        "pptx" => extract_pptx_text(path_str)?,
        "odt" => extract_odt_text(path_str)?,
        "pdf" => {
            // Try pdftotext (poppler), fall back to empty
            let out = std::process::Command::new("pdftotext")
                .arg(path_str)
                .arg("-")
                .output();
            match out {
                Ok(o) if o.status.success() =>
                    String::from_utf8_lossy(&o.stdout).into_owned(),
                _ => String::new(),
            }
        }
        _ => std::fs::read_to_string(path_str).map_err(|e| e.to_string())?,
    };

    let word_count = text.split_whitespace().count();
    Ok(DocumentContent {
        text,
        format: format.to_string(),
        title: None,
        word_count,
    })
}

#[tauri::command]
async fn document_convert(src: String, dest: String) -> Result<(), String> {
    let src_path = resolve_workspace_path(&src)?;
    let dest_path = resolve_workspace_path(&dest)?;
    let src_s = src_path.to_str().ok_or("Invalid src path")?;
    let dest_s = dest_path.to_str().ok_or("Invalid dest path")?;

    let out = std::process::Command::new("pandoc")
        .arg(src_s)
        .arg("-o")
        .arg(dest_s)
        .output()
        .map_err(|_| "pandoc not found — install Pandoc to enable document conversion".to_string())?;

    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

#[tauri::command]
async fn document_create(path: String, format: String, content: String) -> Result<(), String> {
    let dest_path = resolve_workspace_path(&path)?;
    let dest_s = dest_path.to_str().ok_or("Invalid path")?;

    match format.as_str() {
        "md" | "markdown" | "txt" | "text" => {
            std::fs::write(dest_s, content.as_bytes()).map_err(|e| e.to_string())
        }
        _ => {
            // Write a temp markdown file, then convert via pandoc
            let tmp = format!("{dest_s}.tmp.md");
            std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
            let out = std::process::Command::new("pandoc")
                .arg(&tmp)
                .arg("-o")
                .arg(dest_s)
                .output()
                .map_err(|_| "pandoc not found — install Pandoc to create this document format".to_string())?;
            let _ = std::fs::remove_file(&tmp);
            if out.status.success() { Ok(()) } else {
                Err(String::from_utf8_lossy(&out.stderr).into_owned())
            }
        }
    }
}

#[tauri::command]
fn document_formats() -> Vec<String> {
    vec![
        "docx".to_string(), "xlsx".to_string(), "pptx".to_string(),
        "odt".to_string(), "ods".to_string(), "odp".to_string(),
        "pdf".to_string(), "markdown".to_string(), "text".to_string(),
    ]
}

#[tauri::command]
async fn probe_binary(name: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(unix)]
        let probe = std::process::Command::new("which").arg(&name).output();
        #[cfg(windows)]
        let probe = std::process::Command::new("where").arg(&name).output();
        probe.map(|o| o.status.success()).unwrap_or(false)
    })
    .await
    .map_err(|e| e.to_string())
}

// ── Web fetch (#122) ─────────────────────────────────────────────────────────

#[derive(Serialize)]
struct FetchedPage {
    url: String,
    title: String,
    text: String,
    #[serde(rename = "fetchedAt")]
    fetched_at: u64,
}

fn strip_html_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let lower = html.to_ascii_lowercase();
    // Drop <script>…</script> and <style>…</style> blocks first.
    let mut work = html.to_string();
    for tag in &["script", "style"] {
        loop {
            let lo = work.to_ascii_lowercase();
            let open = format!("<{}", tag);
            let close = format!("</{}>", tag);
            match (lo.find(open.as_str()), lo.find(close.as_str())) {
                (Some(s), Some(e)) if e > s => {
                    work = format!("{} {}", &work[..s], &work[e + close.len()..]);
                }
                _ => break,
            }
        }
    }
    let _ = lower; // used above via lo
    // Strip remaining tags char-by-char.
    let mut in_tag = false;
    for ch in work.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => { in_tag = false; out.push(' '); }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    // Collapse whitespace.
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_html_title(html: &str) -> Option<String> {
    let lo = html.to_ascii_lowercase();
    let start = lo.find("<title")? + 6; // past "<title"
    let after_gt = lo[start..].find('>')? + start + 1;
    let end = lo[after_gt..].find("</title>").map(|i| i + after_gt)?;
    let raw = &html[after_gt..end];
    let clean = raw.trim().to_string();
    if clean.is_empty() { None } else { Some(clean) }
}

/// Fetch a URL and return cleaned page text (HTML tags stripped).
/// Used by the agent's web-fetch tool (#122).
#[tauri::command]
async fn fetch_url(
    url: String,
    timeout_ms: Option<u64>,
    max_chars: Option<usize>,
) -> Result<FetchedPage, String> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(15_000));
    let max = max_chars.unwrap_or(20_000);

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("Mozilla/5.0 (compatible; OllamaGUI/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let final_url = resp.url().to_string();
    let body = resp.text().await.map_err(|e| e.to_string())?;

    let title = extract_html_title(&body).unwrap_or_else(|| final_url.clone());
    let text: String = strip_html_tags(&body).chars().take(max).collect();
    let fetched_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Ok(FetchedPage { url: final_url, title, text, fetched_at })
}

// ── Web search (#121) ─────────────────────────────────────────────────────────

#[derive(Serialize)]
struct WebSearchResult {
    title: String,
    url: String,
    snippet: String,
}

/// Parse DuckDuckGo Lite HTML into search results.
fn parse_ddg_lite(html: &str, max: usize) -> Vec<WebSearchResult> {
    let mut results = Vec::new();
    let lo = html.to_ascii_lowercase();
    let mut pos = 0;
    while results.len() < max {
        // Each result link sits in <a class="result-link" href="...">Title</a>
        let class_marker = "class=\"result-link\"";
        let Some(ci) = lo[pos..].find(class_marker) else { break };
        let abs = pos + ci;
        // Walk back to find the href on the enclosing <a …>
        let tag_start = lo[..abs].rfind('<').unwrap_or(abs);
        let Some(href_i) = lo[tag_start..abs + class_marker.len()].find("href=\"") else { pos = abs + 1; continue };
        let href_start = tag_start + href_i + 6;
        let href_end = lo[href_start..].find('"').map(|i| i + href_start).unwrap_or(href_start);
        let url = html[href_start..href_end].trim().to_string();
        // Title: text between > and </a>
        let gt = lo[abs..].find('>').map(|i| i + abs + 1).unwrap_or(abs + 1);
        let end_a = lo[gt..].find("</a>").map(|i| i + gt).unwrap_or(gt);
        let title = strip_html_tags(&html[gt..end_a]).trim().to_string();
        // Snippet follows as <td class="result-snippet">…</td>
        let snippet_marker = "class=\"result-snippet\"";
        let snippet = if let Some(si) = lo[end_a..].find(snippet_marker) {
            let s = end_a + si;
            let sg = lo[s..].find('>').map(|i| i + s + 1).unwrap_or(s + 1);
            let se = lo[sg..].find("</td>").map(|i| i + sg).unwrap_or(sg);
            strip_html_tags(&html[sg..se]).trim().to_string()
        } else {
            String::new()
        };
        if !url.is_empty() && !title.is_empty() {
            results.push(WebSearchResult { title, url, snippet });
        }
        pos = abs + 1;
    }
    results
}

/// Search via DuckDuckGo Lite (no API key required).
async fn search_ddg_lite(query: &str, count: usize) -> Result<Vec<WebSearchResult>, String> {
    let encoded = query.chars().fold(String::new(), |mut s, c| {
        if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '~' {
            s.push(c);
        } else {
            for b in c.to_string().as_bytes() {
                s.push_str(&format!("%{:02X}", b));
            }
        }
        s
    });
    let url = format!("https://lite.duckduckgo.com/lite/?q={}", encoded);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (compatible; OllamaGUI/1.0)")
        .build()
        .map_err(|e| e.to_string())?;
    let body = client.get(&url).send().await.map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())?;
    Ok(parse_ddg_lite(&body, count))
}

/// Search via a self-hosted SearXNG instance (JSON API).
async fn search_searxng(base_url: &str, query: &str, count: usize) -> Result<Vec<WebSearchResult>, String> {
    let url = format!("{}/search?q={}&format=json", base_url.trim_end_matches('/'),
        query.replace(' ', "+"));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let data: serde_json::Value = client.get(&url).send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    let results = data["results"].as_array().cloned().unwrap_or_default();
    Ok(results.into_iter().take(count).filter_map(|r| {
        let title = r["title"].as_str()?.to_string();
        let url = r["url"].as_str()?.to_string();
        let snippet = r["content"].as_str().unwrap_or("").to_string();
        Some(WebSearchResult { title, url, snippet })
    }).collect())
}

/// Web search via DuckDuckGo Lite or a SearXNG instance (#121).
#[tauri::command]
async fn web_search(
    query: String,
    provider: Option<String>,
    count: Option<usize>,
    searxng_url: Option<String>,
) -> Result<Vec<WebSearchResult>, String> {
    let n = count.unwrap_or(5).min(20);
    match provider.as_deref().unwrap_or("duckduckgo") {
        "searxng" => {
            let base = searxng_url.ok_or_else(|| "SearXNG URL required for provider=searxng".to_string())?;
            search_searxng(&base, &query, n).await
        }
        _ => search_ddg_lite(&query, n).await,
    }
}

// ─── Durable store mirror (sessions / projects / folders) ────────────────────
//
// Chat sessions, projects, and folders live in localStorage, which the WebView
// can evict and the user can clear. `persist_store` mirrors each payload to
// <app_data_dir>/store/<key>.json; `load_store` hydrates it back at boot when
// localStorage comes up empty (see App.tsx loadInitialData). Writes are atomic:
// the payload goes to a temp file in the SAME directory first, then a rename
// replaces the previous copy — a crash mid-write can never truncate the last
// good snapshot. Keys are restricted to [a-z0-9_-]+ so a hostile or buggy
// caller can never traverse outside the store directory.

fn valid_store_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// Pure IO helper: atomically write `<base>/store/<key>.json`. Testable with a
/// tempdir base — the #[tauri::command] wrappers only add app_data_dir.
fn store_file_write(base: &std::path::Path, key: &str, json: &str) -> Result<(), String> {
    if !valid_store_key(key) {
        return Err(format!("invalid store key: {key:?} (allowed: [a-z0-9_-]+)"));
    }
    let dir = base.join("store");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{key}.json.tmp"));
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(format!("{key}.json"))).map_err(|e| e.to_string())?;
    Ok(())
}

/// Pure IO helper: read `<base>/store/<key>.json`, `None` when never persisted.
fn store_file_read(base: &std::path::Path, key: &str) -> Result<Option<String>, String> {
    if !valid_store_key(key) {
        return Err(format!("invalid store key: {key:?} (allowed: [a-z0-9_-]+)"));
    }
    match std::fs::read_to_string(base.join("store").join(format!("{key}.json"))) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn persist_store(_app: tauri::AppHandle, key: String, json: String) -> Result<(), String> {
    let base = dirs_next::data_dir()
        .ok_or("Could not find data directory")?
        .join("ollama-gui");
    store_file_write(&base, &key, &json)
}

#[tauri::command]
async fn load_store(_app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let base = dirs_next::data_dir()
        .ok_or("Could not find data directory")?
        .join("ollama-gui");
    store_file_read(&base, &key)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            run_cli,
            probe_binary,
            set_workspace_roots,
            get_workspace_roots,
            get_system_memory,
            path_exists,
            secret_set,
            secret_get,
            secret_delete,
            start_oauth_redirect_listener,
            mcp_stdio_spawn,
            mcp_stdio_send,
            mcp_stdio_read,
            mcp_stdio_close,
            mcp_stdio_check,
            mcp_http_request,
            http_get_binary,
            run_cli_command,
            check_mlx_available,
            mlx_start_server,
            mlx_stop_server,
            mlx_server_status,
            set_workspace_root,
            read_file,
            write_file,
            list_dir,
            apply_edit,
            delete_file,
            search_files,
            glob_files,
            move_path,
            copy_path,
            create_dir,
            terminal_run,
            terminal_kill,
            git_status,
            git_diff,
            git_stage,
            git_unstage,
            git_commit,
            git_log,
            git_reset,
            document_read,
            document_convert,
            document_create,
            document_formats,
            // Tiered converter + edit (#140, #141, #142, #143)
            document_convert::convert_document_tiered,
            document_convert::convert_cancel,
            document_convert::check_libreoffice_available,
            ooxml::document_edit,
            ooxml::document_xlsx_set_cell,
            odf::document_odf_edit,
            odf::document_ods_read,
            pdf_tools::document_pdf_info,
            pdf_tools::document_pdf_merge,
            pdf_tools::document_pdf_split,
            pdf_tools::document_pdf_extract,
            pdf_tools::document_pdf_create,

            // CDP automation engine removed for Tauri v1 compatibility
            fetch_url,
            web_search,
            // Durable store mirror for sessions/projects/folders
            persist_store,
            load_store,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{glob_to_regex, is_skip_dir};

    #[test]
    fn glob_star_stays_within_segment() {
        let re = regex::Regex::new(&glob_to_regex("src/*.ts")).unwrap();
        assert!(re.is_match("src/App.ts"));
        assert!(!re.is_match("src/sub/App.ts")); // * does not cross '/'
        assert!(!re.is_match("src/App.tsx"));
    }

    #[test]
    fn glob_globstar_crosses_segments_and_zero_dirs() {
        let re = regex::Regex::new(&glob_to_regex("**/*.ts")).unwrap();
        assert!(re.is_match("a.ts"));            // zero dirs
        assert!(re.is_match("src/a.ts"));        // one dir
        assert!(re.is_match("src/deep/a.ts"));   // many dirs
        assert!(!re.is_match("src/a.rs"));
    }

    #[test]
    fn glob_question_matches_single_char() {
        let re = regex::Regex::new(&glob_to_regex("file?.ts")).unwrap();
        assert!(re.is_match("file1.ts"));
        assert!(!re.is_match("file.ts"));
        assert!(!re.is_match("file12.ts"));
    }

    #[test]
    fn glob_escapes_regex_metachars() {
        // A dot in the glob is literal, not "any char".
        let re = regex::Regex::new(&glob_to_regex("a.b.txt")).unwrap();
        assert!(re.is_match("a.b.txt"));
        assert!(!re.is_match("axbxtxt"));
    }

    #[test]
    fn skip_dirs_covers_common_noise() {
        assert!(is_skip_dir("node_modules"));
        assert!(is_skip_dir(".git"));
        assert!(is_skip_dir("target"));
        assert!(!is_skip_dir("src"));
    }

    #[test]
    fn path_check_reports_real_directory() {
        // A directory that genuinely exists: temp_dir + a freshly created child.
        let dir = std::env::temp_dir().join("ollamagui_path_check_dir_test");
        std::fs::create_dir_all(&dir).unwrap();
        let check = super::check_path_metadata(dir.to_str().unwrap());
        assert!(check.exists, "created dir should exist");
        assert!(check.is_dir, "created dir should be a directory");
        assert!(check.readable, "created dir should be readable");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn path_check_reports_missing_path() {
        let check = super::check_path_metadata("/definitely/not/a/real/path/ollamagui_550");
        assert!(!check.exists);
        assert!(!check.is_dir);
        assert!(!check.readable);
    }

    #[test]
    fn path_check_file_exists_but_is_not_dir() {
        let file = std::env::temp_dir().join("ollamagui_path_check_file_test.txt");
        std::fs::write(&file, "x").unwrap();
        let check = super::check_path_metadata(file.to_str().unwrap());
        assert!(check.exists);
        assert!(!check.is_dir, "a plain file must not report is_dir");
        assert!(check.readable);
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn path_check_serializes_camel_case_for_js() {
        // platform.ts reads `isDir` — the serde rename must hold (#550).
        let json = serde_json::to_value(super::check_path_metadata("/")).unwrap();
        assert!(json.get("isDir").is_some());
        assert!(json.get("exists").is_some());
        assert!(json.get("readable").is_some());
    }

    #[test]
    fn system_memory_is_plausible() {
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        // Any real machine has a non-zero total, and available <= total.
        assert!(sys.total_memory() > 0, "total memory should be non-zero");
        assert!(sys.available_memory() <= sys.total_memory());
    }


    #[test]
    fn mcp_http_request_deserializes_camel_case_and_optional_session_id() {
        // The JS side (mcp-http.ts) sends camelCase keys; OpenAPI/image-gen
        // omit sessionId entirely. Both must deserialize after #435.
        let camel = serde_json::json!({
            "sessionId": "s1", "method": "POST", "url": "http://x",
            "headers": {}, "body": Some("b".to_string()), "authToken": "t",
        });
        let parsed = serde_json::from_value::<super::McpHttpRequest>(camel).unwrap();
        assert_eq!(parsed.session_id, "s1");
        assert_eq!(parsed.auth_token.as_deref(), Some("t"));
        assert_eq!(parsed.method, "POST");

        // Missing session_id defaults to empty (callers that route HTTP without one).
        let no_session = serde_json::json!({
            "method": "GET", "url": "http://x", "headers": {}, "body": Option::<String>::None,
        });
        let parsed2 = serde_json::from_value::<super::McpHttpRequest>(no_session).unwrap();
        assert_eq!(parsed2.session_id, "");
    }

    #[test]
    fn cli_command_request_response_camel_case_round_trip() {
        // run_cli_command is registered but not yet called from JS. If it ever
        // is, JS will send camelCase (timeoutMs) and read camelCase (exitCode,
        // timedOut) — both structs must round-trip correctly (#437).
        let req = serde_json::json!({
            "command": "npm", "args": ["test"], "cwd": "/tmp",
            "timeoutMs": 5000, "env": {"FOO": "bar"}
        });
        let parsed = serde_json::from_value::<super::CliCommandRequest>(req).unwrap();
        assert_eq!(parsed.command, "npm");
        assert_eq!(parsed.timeout_ms, Some(5000));
        assert_eq!(parsed.cwd.as_deref(), Some("/tmp"));

        // Missing optional fields default correctly.
        let minimal = serde_json::json!({ "command": "ls", "args": [] });
        let parsed2 = serde_json::from_value::<super::CliCommandRequest>(minimal).unwrap();
        assert_eq!(parsed2.timeout_ms, None);

        // Response serializes to camelCase keys.
        let resp = super::CliCommandResponse {
            success: false, exit_code: Some(1), stdout: String::new(),
            stderr: "err".to_string(), error: Some("boom".to_string()),
            timed_out: true,
        };
        let j = serde_json::to_value(&resp).unwrap();
        assert!(j.get("exitCode").is_some(), "exitCode should be camelCase");
        assert!(j.get("timedOut").is_some(), "timedOut should be camelCase");
        assert!(j.get("exit_code").is_none(), "snake_case key should not exist");
    }

    #[test]
    fn mcp_stdio_response_serializes_camel_case() {
        // McpStdioResponse is returned to JS; session_id must serialize as
        // sessionId after #442 (rename_all = camelCase).
        let resp = super::McpStdioResponse {
            success: true,
            message: "ok".to_string(),
            session_id: Some("s1".to_string()),
        };
        let j = serde_json::to_value(&resp).unwrap();
        assert!(j.get("sessionId").is_some(), "sessionId should be camelCase");
        assert!(j.get("session_id").is_none(), "snake_case key should not exist");
        assert_eq!(j.get("success"), Some(&serde_json::Value::Bool(true)));
    }

    #[test]
    fn bytes_to_base64_encodes_png_signature() {
        // The ComfyUI /view endpoint returns binary PNG data; mcp_http_request's
        // .text() would corrupt these bytes. http_get_binary must round-trip them
        // as base64 (#431).
        let png_sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        assert_eq!(super::bytes_to_base64(&png_sig), "iVBORw0KGgo=");
    }

    #[test]
    fn bytes_to_base64_empty_and_roundtrip() {
        assert_eq!(super::bytes_to_base64(&[]), "");
        let data = [0xFF, 0x00, 0xAB, 0x01];
        let enc = super::bytes_to_base64(&data);
        use base64::Engine;
        let dec = base64::engine::general_purpose::STANDARD.decode(&enc).unwrap();
        assert_eq!(dec, data);
    }

    // ── Durable store mirror ────────────────────────────────────────────────

    /// Fresh per-test base dir (stands in for app_data_dir).
    fn store_test_base(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ollamagui_store_test_{name}_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn store_round_trip_and_missing_key() {
        let base = store_test_base("round_trip");
        // Never-persisted key reads back as None, not an error.
        assert_eq!(super::store_file_read(&base, "sessions").unwrap(), None);
        super::store_file_write(&base, "sessions", r#"[{"id":"s1"}]"#).unwrap();
        assert_eq!(
            super::store_file_read(&base, "sessions").unwrap().as_deref(),
            Some(r#"[{"id":"s1"}]"#)
        );
        // Keys are independent files.
        assert_eq!(super::store_file_read(&base, "projects").unwrap(), None);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn store_atomic_overwrite_leaves_no_temp_file() {
        let base = store_test_base("overwrite");
        super::store_file_write(&base, "sessions", "old-payload").unwrap();
        super::store_file_write(&base, "sessions", "new-payload").unwrap();
        assert_eq!(
            super::store_file_read(&base, "sessions").unwrap().as_deref(),
            Some("new-payload")
        );
        // The rename must consume the temp file — only <key>.json remains.
        let names: Vec<String> = std::fs::read_dir(base.join("store"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["sessions.json".to_string()]);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn store_rejects_traversal_and_malformed_keys() {
        let base = store_test_base("bad_keys");
        for bad in ["../evil", "a/b", "a\\b", "", "Sessions", "key.json", "a b", "café"] {
            assert!(
                super::store_file_write(&base, bad, "x").is_err(),
                "write should reject key {bad:?}"
            );
            assert!(
                super::store_file_read(&base, bad).is_err(),
                "read should reject key {bad:?}"
            );
        }
        // Nothing may have been created for rejected keys.
        assert!(!base.exists(), "rejected writes must not create files");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn store_key_validator_accepts_expected_names() {
        assert!(super::valid_store_key("sessions"));
        assert!(super::valid_store_key("projects"));
        assert!(super::valid_store_key("folders"));
        assert!(super::valid_store_key("a-b_c123"));
        assert!(!super::valid_store_key("../x"));
        assert!(!super::valid_store_key(""));
    }
}
