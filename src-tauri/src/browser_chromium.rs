//! Chromium acquisition strategy: system-detect + consented download (#68).
//!
//! The browser-automation features (#102 git panel aside, the headless browse /
//! screenshot tooling) need a Chromium-class engine. Rather than always pulling
//! a ~150 MB binary down on first launch, we prefer a **system install** the
//! user already has (Chrome / Chromium / Edge / Brave) and only fall back to a
//! consented download when nothing is found.
//!
//! This module implements the fully testable, dependency-free half of that
//! strategy now (std only):
//!   - [`candidate_paths`]   — well-known per-OS install locations (cfg-gated).
//!   - [`first_existing`]    — pick the first path that exists (injectable check).
//!   - [`detect_version`]    — run `<path> --version` and parse the build number.
//!   - [`browser_chromium_status`] — the `system | downloaded | none` decision.
//!
//! DEFERRED (needs crate `reqwest` streaming + a runtime download dir, and a
//! Chromium snapshots feed):
//!   - [`browser_chromium_download`] actually fetches + unzips a Chromium build
//!     for the host platform, emitting `chromium://progress` events as it goes.
//!     The signature and registration exist so the command surface is stable;
//!     the body returns a clear "deferred" error until that work is approved.
//!     See manifest.deferred for the full plan.

use serde::Serialize;

/// Outcome of probing for an available Chromium engine.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ChromiumStatus {
    /// True when a usable engine was located (system or previously downloaded).
    pub found: bool,
    /// Where it came from: `"system"`, `"downloaded"`, or `"none"`.
    pub source: String,
    /// Absolute path to the engine binary, if found.
    pub path: Option<String>,
    /// Version string parsed from `--version`, if it could be determined.
    pub version: Option<String>,
}

// ---------------------------------------------------------------------------
// Candidate locations
// ---------------------------------------------------------------------------

/// Well-known install locations for Chrome / Chromium / Edge / Brave on the
/// current OS, in rough preference order (stable Chrome first, then Chromium,
/// then Edge, then Brave). The list is `cfg`-gated so each platform only sees
/// its own plausible paths.
///
/// These are static absolute paths; per-user installs that live behind
/// environment variables (e.g. Windows `%LOCALAPPDATA%`) are expanded at the
/// call site in [`candidate_paths`] for the OSes that need it.
#[cfg(target_os = "macos")]
pub fn candidate_paths() -> Vec<&'static str> {
    vec![
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ]
}

#[cfg(target_os = "linux")]
pub fn candidate_paths() -> Vec<&'static str> {
    vec![
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/opt/google/chrome/chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/usr/bin/microsoft-edge",
        "/usr/bin/microsoft-edge-stable",
        "/usr/bin/brave-browser",
        "/usr/bin/brave",
    ]
}

#[cfg(target_os = "windows")]
pub fn candidate_paths() -> Vec<&'static str> {
    // Note: these cover the system-wide `Program Files` installs. Per-user
    // installs under `%LOCALAPPDATA%` are handled by the leaking-into-'static
    // expansion below so the public signature stays `Vec<&'static str>` and the
    // pure helpers remain trivially testable on every platform.
    let mut paths: Vec<&'static str> = vec![
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Chromium\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        r"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
    ];
    // Per-user Chrome install (the common non-admin case). We intentionally leak
    // the formatted path to obtain a `'static` reference — this runs at most
    // once per status check and the allocation is negligible.
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let user_chrome = format!(r"{local}\Google\Chrome\Application\chrome.exe");
        paths.push(Box::leak(user_chrome.into_boxed_str()));
        let user_edge = format!(r"{local}\Microsoft\Edge\Application\msedge.exe");
        paths.push(Box::leak(user_edge.into_boxed_str()));
    }
    paths
}

// Fallback for any other target so the crate still compiles everywhere.
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub fn candidate_paths() -> Vec<&'static str> {
    Vec::new()
}

// ---------------------------------------------------------------------------
// Pure, testable helpers
// ---------------------------------------------------------------------------

/// Return the first path in `paths` for which `exists` returns true.
///
/// The existence check is injected so this is unit-testable without touching the
/// filesystem: production callers pass a closure backed by
/// [`std::path::Path::exists`]; tests pass a closure over a fixed set.
pub fn first_existing(paths: &[&str], exists: impl Fn(&str) -> bool) -> Option<String> {
    paths
        .iter()
        .find(|p| exists(p))
        .map(|p| p.to_string())
}

/// Resolve a system Chromium-class binary path from the well-known locations,
/// or `None` if none is installed. Used by the CDP engine (#73) to launch.
pub fn resolve_system_path() -> Option<String> {
    first_existing(&candidate_paths(), |p| std::path::Path::new(p).exists())
}

/// Parse a Chromium-class `--version` line into a bare version string.
///
/// Browsers print lines like:
///   - `Google Chrome 124.0.6367.207`
///   - `Chromium 123.0.6312.122 snap`
///   - `Microsoft Edge 124.0.2478.97`
///   - `Brave Browser 1.65.126 Chromium: 124.0.6367.118`
///
/// We return the first whitespace-separated token that looks like a dotted
/// numeric version (at least one `.` and only digits/dots). Returns `None` when
/// no such token is present.
pub fn parse_version(stdout: &str) -> Option<String> {
    stdout
        .split_whitespace()
        .find(|tok| {
            tok.contains('.')
                && !tok.is_empty()
                && tok.chars().all(|c| c.is_ascii_digit() || c == '.')
                // Guard against a stray leading/trailing dot being treated as
                // a "version" (e.g. an ellipsis token).
                && tok.chars().any(|c| c.is_ascii_digit())
        })
        .map(|tok| tok.to_string())
}

/// Run `<path> --version` and parse the build number out of stdout.
///
/// Returns `None` if the binary cannot be executed or prints nothing parseable.
/// Kept separate from [`parse_version`] so the parsing stays pure + tested while
/// this thin wrapper handles the process I/O.
pub fn detect_version(path: &str) -> Option<String> {
    let output = std::process::Command::new(path)
        .arg("--version")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_version(&String::from_utf8_lossy(&output.stdout))
}

/// Resolve the path a previously downloaded Chromium would live at inside the
/// app-data directory, and return it only if the binary actually exists.
///
/// This is split out as a pure helper (taking the resolved app-data dir and an
/// injectable existence check) so the `downloaded` branch of the status logic is
/// testable without an `AppHandle`. The on-disk layout mirrors what the deferred
/// downloader will produce: `<app-data>/chromium/<platform-binary>`.
pub fn downloaded_path(app_data_dir: &std::path::Path, exists: impl Fn(&str) -> bool) -> Option<String> {
    let binary = downloaded_binary_name();
    let candidate = app_data_dir.join("chromium").join(binary);
    let candidate_str = candidate.to_str()?.to_string();
    if exists(&candidate_str) {
        Some(candidate_str)
    } else {
        None
    }
}

/// The relative binary name a downloaded Chromium snapshot exposes for this OS.
/// Centralised so the downloader and the detector agree on the layout.
pub fn downloaded_binary_name() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Chromium.app/Contents/MacOS/Chromium"
    }
    #[cfg(target_os = "linux")]
    {
        "chrome"
    }
    #[cfg(target_os = "windows")]
    {
        "chrome.exe"
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        "chrome"
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Report whether a Chromium engine is available and where it came from.
///
/// Resolution order:
///   1. A previously **downloaded** engine cached in app-data
///      (`<app-data>/chromium/...`) — preferred because it is version-pinned.
///   2. A **system** install from [`candidate_paths`].
///   3. Otherwise `source: "none"` so the frontend can prompt for a download.
///
/// When an engine is found we attempt [`detect_version`]; a missing version is
/// non-fatal (`found` stays true) since some sandboxes block the probe.
#[tauri::command]
pub async fn browser_chromium_status(app: tauri::AppHandle) -> Result<ChromiumStatus, String> {
    use tauri::Manager;

    // Resolve the app-data dir up front (cheap, on the calling thread) so the
    // blocking probe below is pure path work.
    let app_data = app.path().app_data_dir().ok();

    tauri::async_runtime::spawn_blocking(move || {
        let on_disk = |p: &str| std::path::Path::new(p).exists();

        // 1. Cached download wins (version-pinned, no surprises).
        if let Some(dir) = app_data {
            if let Some(found) = downloaded_path(&dir, on_disk) {
                let version = detect_version(&found);
                return ChromiumStatus {
                    found: true,
                    source: "downloaded".to_string(),
                    path: Some(found),
                    version,
                };
            }
        }

        // 2. Fall back to a system install.
        let candidates = candidate_paths();
        if let Some(found) = first_existing(&candidates, on_disk) {
            let version = detect_version(&found);
            return ChromiumStatus {
                found: true,
                source: "system".to_string(),
                path: Some(found),
                version,
            };
        }

        // 3. Nothing — caller should offer a consented download.
        ChromiumStatus {
            found: false,
            source: "none".to_string(),
            path: None,
            version: None,
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Download a Chromium build for the host platform (consented by the user).
///
/// DEFERRED (needs `reqwest` streaming download + unzip into app-data + a
/// Chromium snapshots feed):
///   - Resolve the correct snapshot URL for `(OS, ARCH)`.
///   - Stream the archive to `<app-data>/chromium/`, emitting
///     `chromium://progress` events (`{ received, total }`) via
///     `app.emit("chromium://progress", ...)` so the UI can show a bar —
///     mirroring the `terminal_run` event pattern already in `lib.rs`.
///   - Unzip with the in-tree `zip` crate, mark the binary executable on Unix,
///     and return its absolute path.
///
/// Map (os, arch) to the Chrome-for-Testing platform key, or `None` if the
/// platform has no published build.
pub fn cft_platform(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Some("mac-arm64"),
        ("macos", "x86_64") => Some("mac-x64"),
        ("linux", "x86_64") => Some("linux64"),
        ("windows", _) => Some("win64"),
        _ => None,
    }
}

/// The extracted binary's path within `dir` for a CfT zip of the given platform.
fn extracted_chrome_path(dir: &std::path::Path, platform: &str) -> std::path::PathBuf {
    match platform {
        "mac-arm64" | "mac-x64" => dir
            .join(format!("chrome-{platform}"))
            .join("Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        "win64" | "win32" => dir.join(format!("chrome-{platform}")).join("chrome.exe"),
        _ => dir.join(format!("chrome-{platform}")).join("chrome"),
    }
}

/// Download a Chrome-for-Testing build (user-consented) with progress events,
/// extract it into the app-data dir, and return the resolved binary path (#68).
///
/// Emits `chromium://progress` (a 0..1 ratio) as bytes stream in. This is the
/// explicit fallback when no system Chromium is detected — never auto-invoked.
#[tauri::command]
pub async fn browser_chromium_download(app: tauri::AppHandle) -> Result<String, String> {
    use futures::StreamExt;
    use std::io::Write;
    use tauri::{Emitter, Manager};

    let platform = cft_platform(std::env::consts::OS, std::env::consts::ARCH)
        .ok_or("No Chrome-for-Testing build for this platform")?;

    // 1. Resolve the stable chrome download URL for this platform.
    let index: serde_json::Value = reqwest::get(
        "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json",
    )
    .await
    .map_err(|e| format!("Failed to fetch CfT index: {e}"))?
    .json()
    .await
    .map_err(|e| format!("Bad CfT index JSON: {e}"))?;
    let url = index["channels"]["Stable"]["downloads"]["chrome"]
        .as_array()
        .ok_or("Unexpected CfT index format")?
        .iter()
        .find(|d| d["platform"].as_str() == Some(platform))
        .and_then(|d| d["url"].as_str())
        .ok_or("No Chromium build for this platform in the CfT index")?
        .to_string();

    // 2. Stream the archive into app-data, emitting progress.
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("chromium");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let zip_path = dir.join("chrome.zip");

    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let total = resp.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let ratio = if total > 0 { downloaded as f64 / total as f64 } else { 0.0 };
        let _ = app.emit("chromium://progress", ratio);
    }
    drop(file);

    // 3. Extract and locate the binary.
    let zf = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(zf).map_err(|e| e.to_string())?;
    archive.extract(&dir).map_err(|e| format!("Failed to extract: {e}"))?;
    let _ = std::fs::remove_file(&zip_path);

    let bin = extracted_chrome_path(&dir, platform);
    if !bin.exists() {
        return Err("Downloaded archive did not contain the expected Chromium binary".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755));
    }
    let _ = app.emit("chromium://progress", 1.0_f64);
    Ok(bin.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_existing_returns_first_present() {
        let paths = ["/none/a", "/yes/b", "/yes/c"];
        // Only paths beginning with "/yes/" "exist".
        let found = first_existing(&paths, |p| p.starts_with("/yes/"));
        assert_eq!(found, Some("/yes/b".to_string()));
    }

    #[test]
    fn cft_platform_maps_known_targets() {
        assert_eq!(cft_platform("macos", "aarch64"), Some("mac-arm64"));
        assert_eq!(cft_platform("macos", "x86_64"), Some("mac-x64"));
        assert_eq!(cft_platform("linux", "x86_64"), Some("linux64"));
        assert_eq!(cft_platform("windows", "x86_64"), Some("win64"));
        assert_eq!(cft_platform("freebsd", "x86_64"), None);
    }

    #[test]
    fn extracted_chrome_path_is_platform_specific() {
        let dir = std::path::Path::new("/tmp/c");
        assert!(extracted_chrome_path(dir, "linux64").ends_with("chrome-linux64/chrome"));
        assert!(extracted_chrome_path(dir, "win64").ends_with("chrome.exe"));
        assert!(extracted_chrome_path(dir, "mac-arm64")
            .to_string_lossy()
            .contains("Google Chrome for Testing.app"));
    }

    #[test]
    fn first_existing_none_when_all_absent() {
        let paths = ["/none/a", "/none/b"];
        let found = first_existing(&paths, |_| false);
        assert_eq!(found, None);
    }

    #[test]
    fn first_existing_empty_slice_is_none() {
        let paths: [&str; 0] = [];
        assert_eq!(first_existing(&paths, |_| true), None);
    }

    #[test]
    fn parses_chrome_version() {
        assert_eq!(
            parse_version("Google Chrome 124.0.6367.207 \n"),
            Some("124.0.6367.207".to_string())
        );
    }

    #[test]
    fn parses_chromium_and_edge() {
        assert_eq!(
            parse_version("Chromium 123.0.6312.122 snap"),
            Some("123.0.6312.122".to_string())
        );
        assert_eq!(
            parse_version("Microsoft Edge 124.0.2478.97"),
            Some("124.0.2478.97".to_string())
        );
    }

    #[test]
    fn parses_brave_first_dotted_token() {
        // Brave prints its own version before the embedded Chromium one; we
        // take the first dotted-numeric token.
        assert_eq!(
            parse_version("Brave Browser 1.65.126 Chromium: 124.0.6367.118"),
            Some("1.65.126".to_string())
        );
    }

    #[test]
    fn version_none_when_unparseable() {
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_version("no version here"), None);
        // A bare word with no dot is not a version.
        assert_eq!(parse_version("Chrome stable"), None);
    }

    #[test]
    fn downloaded_path_present_and_absent() {
        let dir = std::path::Path::new("/app-data");
        let expected = dir
            .join("chromium")
            .join(downloaded_binary_name())
            .to_string_lossy()
            .into_owned();

        // Present: the existence check returns true for the cached binary.
        let want = expected.clone();
        let found = downloaded_path(dir, move |p| p == want);
        assert_eq!(found, Some(expected));

        // Absent: nothing on disk -> None.
        assert_eq!(downloaded_path(dir, |_| false), None);
    }

    #[test]
    fn candidate_paths_is_nonempty_on_supported_os() {
        // On the three first-class platforms we always have candidates to probe.
        #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
        assert!(!candidate_paths().is_empty());
    }
}
