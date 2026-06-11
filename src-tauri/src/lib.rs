use serde::Serialize;
use std::process::Stdio;
use std::sync::mpsc;
use std::time::Duration;

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
#[tauri::command]
async fn run_cli(
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CliOutput, String> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000));

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

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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
struct CliCommandRequest {
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    env: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CliCommandResponse {
    success: bool,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    error: Option<String>,
    timed_out: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct McpHttpRequest {
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

fn secret_fallback_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
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
async fn secret_delete(app: tauri::AppHandle, service: String, key: String) -> Result<(), String> {
    let _ = keyring::Entry::new(&service, &key).and_then(|e| e.delete_credential());
    let _ = secret_fallback_delete(&app, &service, &key);
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

/// Check whether an executable is available on PATH (e.g. docker, uvx, npx).
/// Used by connector UX to detect prerequisites without a shell plugin.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            run_cli,
            probe_binary,
            get_system_memory,
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
            run_cli_command,
            check_mlx_available,
            mlx_start_server,
            mlx_stop_server,
            mlx_server_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn system_memory_is_plausible() {
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        // Any real machine has a non-zero total, and available <= total.
        assert!(sys.total_memory() > 0, "total memory should be non-zero");
        assert!(sys.available_memory() <= sys.total_memory());
    }
}
