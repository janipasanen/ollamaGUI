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

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, run_cli])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
