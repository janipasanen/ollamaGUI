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

use std::process::{Command, Stdio, Child, ChildStdin, ChildStdout, ChildStderr};
use std::io::{Write, BufRead, BufReader};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use serde::{Serialize, Deserialize};
use tauri::Manager;
use reqwest::Client;
use tokio::sync::mpsc;

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
    let process = processes.remove(&session_id).ok_or("Session not found")?;
    
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
    // Initialize HTTP client if not already done
    let mut client_guard = MCP_HTTP_CLIENT.lock().map_err(|e| e.to_string())?;
    if client_guard.is_none() {
        *client_guard = Some(Client::new());
    }
    let client = client_guard.as_ref().unwrap().clone();
    
    drop(client_guard); // Release the lock early
    
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
    
    // Read the response body
    let body = response.text().await.map_err(|e| e.to_string())?;
    
    // Collect response headers
    let mut response_headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value_str) = value.to_str() {
            response_headers.insert(key.to_string(), value_str.to_string());
        }
    }
    
    Ok(McpHttpResponse {
        success: response.status().is_success(),
        status: response.status().as_u16(),
        headers: response_headers,
        body,
        error: None,
    })
}

#[tauri::command]
async fn run_cli_command(
    request: CliCommandRequest,
) -> Result<CliCommandResponse, String> {
    // Check command against allowlist/denylist
    let command_name = request.command.split_whitespace().next().unwrap_or("");
    
    let allowlist = CLI_ALLOWLIST.lock().map_err(|e| e.to_string())?;
    let denylist = CLI_DENYLIST.lock().map_err(|e| e.to_string())?;
    
    if denylist.contains(&command_name.to_string()) {
        return Ok(CliCommandResponse {
            success: false,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            error: Some("Command is blocked by security policy".to_string()),
            timed_out: false,
        });
    }
    
    if !allowlist.is_empty() && !allowlist.contains(&command_name.to_string()) {
        return Ok(CliCommandResponse {
            success: false,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            error: Some("Command not in allowlist".to_string()),
            timed_out: false,
        });
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
    
    let start_time = Instant::now();
    let timeout = request.timeout_ms.map(Duration::from_millis);
    
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    
    let stdout_handle = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr_handle = child.stderr.take().ok_or("Failed to capture stderr")?;
    
    let mut stdout_reader = BufReader::new(stdout_handle);
    let mut stderr_reader = BufReader::new(stderr_handle);
    
    let mut stdout = String::new();
    let mut stderr = String::new();
    
    // Read output in background
    let stdout_task = tauri::async_runtime::spawn(async move {
        stdout_reader.read_to_string(&mut stdout).unwrap_or(0)
    });
    
    let stderr_task = tauri::async_runtime::spawn(async move {
        stderr_reader.read_to_string(&mut stderr).unwrap_or(0)
    });
    
    // Wait for process to complete or timeout
    let status = if let Some(timeout_duration) = timeout {
        match child.wait_timeout(timeout_duration).map_err(|e| e.to_string())? {
            Some(status) => status,
            None => {
                let _ = child.kill();
                return Ok(CliCommandResponse {
                    success: false,
                    exit_code: None,
                    stdout: stdout_task.await.unwrap_or(0).to_string(),
                    stderr: stderr_task.await.unwrap_or(0).to_string(),
                    error: Some("Command timed out".to_string()),
                    timed_out: true,
                });
            }
        }
    } else {
        child.wait().map_err(|e| e.to_string())?
    };
    
    // Wait for output tasks to complete
    let _ = stdout_task.await;
    let _ = stderr_task.await;
    
    let exit_code = status.code();
    
    Ok(CliCommandResponse {
        success: status.success(),
        exit_code,
        stdout,
        stderr,
        error: None,
        timed_out: false,
    })
}

#[tauri::command]
async fn mcp_stdio_check(
    session_id: String,
) -> Result<bool, String> {
    let processes = MCP_PROCESSES.lock().map_err(|e| e.to_string())?;
    Ok(processes.contains_key(&session_id))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            run_cli,
            start_oauth_redirect_listener,
            mcp_stdio_spawn,
            mcp_stdio_send,
            mcp_stdio_read,
            mcp_stdio_close,
            mcp_stdio_check,
            mcp_http_request,
            run_cli_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
