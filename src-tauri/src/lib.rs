// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
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
            mcp_stdio_spawn,
            mcp_stdio_send,
            mcp_stdio_read,
            mcp_stdio_close,
            mcp_stdio_check,
            run_cli_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
