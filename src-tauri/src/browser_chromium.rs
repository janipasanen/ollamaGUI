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
/// Until then this returns a clear, actionable error so callers fail loudly and
/// the user is steered toward a system install.
///
/// Reference shape for the real implementation:
/// ```ignore
/// use tauri::{Emitter, Manager};
/// let url = snapshot_url(std::env::consts::OS, std::env::consts::ARCH)?;
/// let dir = app.path().app_data_dir()?.join("chromium");
/// std::fs::create_dir_all(&dir)?;
/// // stream `url` -> archive, emit "chromium://progress" per chunk,
/// // unzip into `dir`, chmod +x on unix, then:
/// Ok(dir.join(downloaded_binary_name()).to_string_lossy().into_owned())
/// ```
#[tauri::command]
pub async fn browser_chromium_download() -> Result<String, String> {
    Err("Chromium download not yet implemented — locate a system install".to_string())
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
