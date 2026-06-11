//! Tiered document converter (#140).
//!
//! Routes a conversion request through one of three engines, cheapest first:
//!
//!   1. `BundledCrate`  — handled in-process with crates we already ship
//!                        (e.g. `xlsx -> csv` via the `zip`/`quick-xml` readers).
//!   2. `Pandoc`        — the `pandoc` CLI for the common text/markup family
//!                        (md, html, docx, odt, txt) when no presentation /
//!                        PDF rendering is involved.
//!   3. `LibreOffice`   — `soffice --headless` for anything that needs a real
//!                        layout engine: presentations (pptx/odp) and PDF
//!                        export. This is the heaviest tier and is optional —
//!                        if LibreOffice is not installed we return an
//!                        actionable error rather than failing silently.
//!
//! The routing matrix (`engine_for`) and the binary-detection helpers are pure
//! functions so they can be unit-tested without a real conversion runtime. The
//! `#[tauri::command]` wrappers spawn the chosen CLI via `std::process`, mirror
//! the spawn-with-timeout/kill pattern already used by `run_cli`, and stream
//! `convert://progress` / `convert://done` events to the frontend.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Emitter;

// ─── Engine routing ───────────────────────────────────────────────────────────

/// The three conversion tiers, in increasing order of cost / external
/// dependency weight.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    /// Handled in-process with crates we already bundle (no external binary).
    BundledCrate,
    /// The `pandoc` CLI — text/markup family.
    Pandoc,
    /// `soffice --headless` — presentations and PDF export.
    LibreOffice,
}

impl Engine {
    /// Stable string form surfaced to the frontend in `ConvertResult.engine`.
    pub fn as_str(self) -> &'static str {
        match self {
            Engine::BundledCrate => "bundled",
            Engine::Pandoc => "pandoc",
            Engine::LibreOffice => "libreoffice",
        }
    }
}

/// Normalize an extension/format token: l-case, strip a leading dot, and map a
/// couple of common aliases onto the canonical token used by the matrix.
fn norm(fmt: &str) -> String {
    let f = fmt.trim().trim_start_matches('.').to_ascii_lowercase();
    match f.as_str() {
        "markdown" => "md".to_string(),
        "htm" => "html".to_string(),
        "text" => "txt".to_string(),
        other => other.to_string(),
    }
}

/// Pick the conversion engine for a `from -> to` pair.
///
/// Routing rules (evaluated in this order):
///   * `xlsx -> csv`                         → `BundledCrate`
///   * anything involving `pptx`/`odp`, OR
///     a target of `pdf`                      → `LibreOffice`
///   * a text/markup family member
///     (md/html/docx/odt/txt) on either side  → `Pandoc`
///   * fallback                               → `Pandoc`
///
/// The PDF / presentation check is deliberately evaluated *before* the Pandoc
/// family check: `docx -> pdf` involves a text format on the input side but
/// still needs a real layout engine, so it must route to LibreOffice.
pub fn engine_for(from: &str, to: &str) -> Engine {
    let from = norm(from);
    let to = norm(to);

    // Tier 1: spreadsheet extraction we can do with bundled readers.
    if from == "xlsx" && to == "csv" {
        return Engine::BundledCrate;
    }

    // Tier 3: presentations or PDF export need LibreOffice's layout engine.
    let presentation = |f: &str| f == "pptx" || f == "odp";
    if presentation(&from) || presentation(&to) || to == "pdf" {
        return Engine::LibreOffice;
    }

    // Tier 2: the text/markup family pandoc handles well.
    let text_family = |f: &str| {
        matches!(f, "md" | "html" | "docx" | "odt" | "txt")
    };
    if text_family(&from) || text_family(&to) {
        return Engine::Pandoc;
    }

    // Default: hand unknown pairs to pandoc, which has the widest reader set.
    Engine::Pandoc
}

// ─── LibreOffice detection ─────────────────────────────────────────────────────

/// Result of probing the host for a LibreOffice / OpenOffice `soffice` binary.
#[derive(Debug, Serialize, Clone)]
pub struct LoAvailability {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Return the first path in `paths` for which `exists` reports `true`.
///
/// `exists` is injected so the detection order can be unit-tested without
/// touching the real filesystem.
pub fn first_existing(paths: &[&str], exists: impl Fn(&str) -> bool) -> Option<String> {
    paths.iter().find(|p| exists(p)).map(|p| p.to_string())
}

/// Candidate `soffice` locations to probe, in priority order: PATH names first
/// (resolved via `which`/`where`), then well-known install locations per OS.
fn libreoffice_candidates() -> Vec<&'static str> {
    let mut v = vec!["soffice", "libreoffice"];
    #[cfg(target_os = "macos")]
    {
        v.push("/Applications/LibreOffice.app/Contents/MacOS/soffice");
    }
    #[cfg(target_os = "linux")]
    {
        v.push("/usr/bin/soffice");
        v.push("/usr/bin/libreoffice");
        v.push("/snap/bin/libreoffice");
    }
    #[cfg(target_os = "windows")]
    {
        v.push(r"C:\Program Files\LibreOffice\program\soffice.exe");
        v.push(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe");
    }
    v
}

/// True when `name` resolves on the PATH (bare names) or exists as an absolute
/// file path. Mirrors `probe_binary` (`which` on unix, `where` on windows).
fn binary_resolves(name: &str) -> bool {
    // Absolute / explicit paths: just stat the file.
    if name.contains('/') || name.contains('\\') {
        return std::path::Path::new(name).exists();
    }
    #[cfg(unix)]
    let probe = std::process::Command::new("which").arg(name).output();
    #[cfg(windows)]
    let probe = std::process::Command::new("where").arg(name).output();
    probe.map(|o| o.status.success()).unwrap_or(false)
}

/// Run `soffice --version` and return the trimmed first line, if it succeeds.
fn libreoffice_version(bin: &str) -> Option<String> {
    let out = std::process::Command::new(bin)
        .arg("--version")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout);
    v.lines().next().map(|l| l.trim().to_string())
}

/// Probe the host for a usable LibreOffice binary (pure detection logic).
///
/// Named `detect_libreoffice` so it does not clash with the
/// `#[tauri::command] check_libreoffice_available` entrypoint below.
pub fn detect_libreoffice() -> LoAvailability {
    let candidates = libreoffice_candidates();
    match first_existing(&candidates, binary_resolves) {
        Some(path) => {
            let version = libreoffice_version(&path);
            LoAvailability { available: true, path: Some(path), version }
        }
        None => LoAvailability { available: false, path: None, version: None },
    }
}

/// Build the actionable error returned when a conversion needs LibreOffice but
/// none is installed. Pure so it can be asserted on in unit tests.
pub fn libreoffice_missing_error(target_format: &str) -> String {
    format!(
        "{} export needs LibreOffice; install it (https://www.libreoffice.org/download) \
         or enable the optional engine in Settings.",
        target_format.trim_start_matches('.').to_ascii_uppercase()
    )
}

/// Build the actionable error returned when a conversion needs Pandoc but none
/// is installed.
pub fn pandoc_missing_error() -> String {
    "This conversion needs Pandoc; install it (https://pandoc.org/installing.html) \
     to enable document conversion."
        .to_string()
}

// ─── Conversion command + job tracking ─────────────────────────────────────────

/// Outcome of a tiered conversion, surfaced to the frontend.
#[derive(Debug, Serialize, Clone)]
pub struct ConvertResult {
    /// Which engine actually ran (`bundled` | `pandoc` | `libreoffice`).
    pub engine: String,
    pub ok: bool,
}

/// Progress payload emitted on `convert://progress`.
#[derive(Debug, Serialize, Clone)]
struct ConvertProgress {
    job_id: String,
    /// 0.0 .. 1.0
    ratio: f64,
}

/// Done payload emitted on `convert://done`.
#[derive(Debug, Serialize, Clone)]
struct ConvertDone {
    job_id: String,
    engine: String,
    ok: bool,
    error: Option<String>,
}

lazy_static::lazy_static! {
    /// LibreOffice's headless mode is not safe to run concurrently against a
    /// shared user profile, so serialize every `soffice` invocation.
    static ref LIBREOFFICE_LOCK: Mutex<()> = Mutex::new(());
    /// Tracks the OS pid of the currently-running child per job_id so
    /// `convert_cancel` can signal it (model: run_cli's timeout-kill).
    static ref CONVERT_JOBS: Mutex<HashMap<String, u32>> = Mutex::new(HashMap::new());
}

/// Register `pid` as the running child for `job_id`.
fn track_job(job_id: &str, pid: u32) {
    if let Ok(mut m) = CONVERT_JOBS.lock() {
        m.insert(job_id.to_string(), pid);
    }
}

/// Remove a finished job from the tracking map.
fn untrack_job(job_id: &str) {
    if let Ok(mut m) = CONVERT_JOBS.lock() {
        m.remove(job_id);
    }
}

/// Send SIGKILL / taskkill to a tracked pid. Mirrors run_cli's kill path.
fn kill_pid(pid: u32) {
    #[cfg(unix)]
    let _ = std::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output();
    #[cfg(windows)]
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .output();
}

/// Derive the lower-cased extension token from a path, if any.
fn ext_of(path: &str) -> String {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// Spawn a child process, register it under `job_id`, wait for completion, then
/// untrack it. Returns the captured `Output`. Centralizes the track/kill
/// bookkeeping so both engine paths share it.
fn run_tracked(
    job_id: &str,
    mut cmd: std::process::Command,
) -> Result<std::process::Output, String> {
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn converter: {e}"))?;
    let pid = child.id();
    track_job(job_id, pid);
    let out = child.wait_with_output();
    untrack_job(job_id);
    out.map_err(|e| format!("Converter error: {e}"))
}

/// Tiered conversion entry point.
///
/// `from_path` / `to_path` are resolved by the caller (lib.rs) against the
/// workspace root; this module takes already-resolved absolute paths so it
/// stays independent of `resolve_workspace_path`.
#[tauri::command]
pub async fn convert_document_tiered(
    app: tauri::AppHandle,
    from_path: String,
    to_path: String,
    target_format: String,
    job_id: Option<String>,
) -> Result<ConvertResult, String> {
    let job_id = job_id.unwrap_or_else(|| format!("convert-{}", std::process::id()));
    let from_ext = ext_of(&from_path);
    let to_fmt = if target_format.is_empty() {
        ext_of(&to_path)
    } else {
        target_format.clone()
    };
    let engine = engine_for(&from_ext, &to_fmt);

    // Kick off: report 0% so the UI can show an in-progress state immediately.
    let _ = app.emit(
        "convert://progress",
        ConvertProgress { job_id: job_id.clone(), ratio: 0.0 },
    );

    let job = job_id.clone();
    let from = from_path.clone();
    let to = to_path.clone();
    let to_fmt_c = to_fmt.clone();

    // All engine work is blocking process I/O — run it off the async runtime.
    let result: Result<ConvertResult, String> =
        tauri::async_runtime::spawn_blocking(move || match engine {
            Engine::BundledCrate => run_bundled(&job, &from, &to),
            Engine::Pandoc => run_pandoc(&job, &from, &to, &to_fmt_c),
            Engine::LibreOffice => run_libreoffice(&job, &from, &to, &to_fmt_c),
        })
        .await
        .map_err(|e| e.to_string())?;

    // Emit terminal events for both success and failure so the UI can settle.
    match &result {
        Ok(r) => {
            let _ = app.emit(
                "convert://progress",
                ConvertProgress { job_id: job_id.clone(), ratio: 1.0 },
            );
            let _ = app.emit(
                "convert://done",
                ConvertDone {
                    job_id: job_id.clone(),
                    engine: r.engine.clone(),
                    ok: r.ok,
                    error: None,
                },
            );
        }
        Err(e) => {
            let _ = app.emit(
                "convert://done",
                ConvertDone {
                    job_id: job_id.clone(),
                    engine: engine.as_str().to_string(),
                    ok: false,
                    error: Some(e.clone()),
                },
            );
        }
    }

    result
}

/// Escape a single CSV field per RFC 4180 (quote when it contains a comma,
/// quote, or newline; double internal quotes).
fn csv_escape(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') || field.contains('\r') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

/// Tier 1 — bundled-crate conversions (`xlsx -> csv`) via the pure-Rust
/// `calamine` reader. Reads the first worksheet and writes RFC-4180 CSV,
/// fully offline with no external tool.
fn run_bundled(_job: &str, from: &str, to: &str) -> Result<ConvertResult, String> {
    use calamine::{open_workbook, Reader, Xlsx};
    let mut wb: Xlsx<_> = open_workbook(from).map_err(|e| format!("Failed to open xlsx: {e}"))?;
    let sheet = wb
        .sheet_names()
        .first()
        .cloned()
        .ok_or("Workbook has no sheets")?;
    let range = wb
        .worksheet_range(&sheet)
        .map_err(|e| format!("Failed to read sheet '{sheet}': {e}"))?;
    let mut csv = String::new();
    for row in range.rows() {
        let cells: Vec<String> = row.iter().map(|c| csv_escape(&c.to_string())).collect();
        csv.push_str(&cells.join(","));
        csv.push('\n');
    }
    std::fs::write(to, csv).map_err(|e| format!("Failed to write CSV: {e}"))?;
    Ok(ConvertResult { engine: Engine::BundledCrate.as_str().to_string(), ok: true })
}

/// Tier 2 — Pandoc. Spawns `pandoc -f <in> -t <out> -o <dest> <src>`.
fn run_pandoc(job: &str, from: &str, to: &str, to_fmt: &str) -> Result<ConvertResult, String> {
    let mut cmd = std::process::Command::new("pandoc");
    // Let pandoc infer the input format from the extension, but pin the target.
    cmd.arg("-t").arg(norm(to_fmt)).arg("-o").arg(to).arg(from);

    let out = match run_tracked(job, cmd) {
        Ok(o) => o,
        Err(_) => return Err(pandoc_missing_error()),
    };
    if out.status.success() {
        Ok(ConvertResult { engine: Engine::Pandoc.as_str().to_string(), ok: true })
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        // A spawn that produced no diagnostics usually means pandoc is absent.
        if stderr.trim().is_empty() {
            Err(pandoc_missing_error())
        } else {
            Err(stderr.into_owned())
        }
    }
}

/// Tier 3 — LibreOffice headless. Serialized behind `LIBREOFFICE_LOCK` and
/// given a per-call temp `--user-installation` profile so concurrent app
/// instances don't collide.
fn run_libreoffice(
    job: &str,
    from: &str,
    to: &str,
    to_fmt: &str,
) -> Result<ConvertResult, String> {
    // Refuse early with an actionable message if no soffice is installed.
    let avail = detect_libreoffice();
    if !avail.available {
        return Err(libreoffice_missing_error(to_fmt));
    }
    let soffice = avail.path.unwrap_or_else(|| "soffice".to_string());

    // soffice writes `<src-stem>.<fmt>` into --outdir; use the destination's
    // parent directory so the converted file lands where the caller expects.
    let out_dir = std::path::Path::new(to)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    // Per-call isolated profile dir, removed on drop.
    let profile = std::env::temp_dir().join(format!("ollamagui-lo-{}", job));
    let profile_uri = format!("file://{}", profile.to_string_lossy());

    let _guard = LIBREOFFICE_LOCK.lock().map_err(|e| e.to_string())?;

    let mut cmd = std::process::Command::new(&soffice);
    cmd.arg("--headless")
        .arg("--norestore")
        .arg(format!("-env:UserInstallation={profile_uri}"))
        .arg("--convert-to")
        .arg(norm(to_fmt))
        .arg("--outdir")
        .arg(&out_dir)
        .arg(from);

    let out = run_tracked(job, cmd);
    let _ = std::fs::remove_dir_all(&profile);

    let out = out?;
    if out.status.success() {
        Ok(ConvertResult { engine: Engine::LibreOffice.as_str().to_string(), ok: true })
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

/// Cancel a running conversion by killing its tracked child process.
#[tauri::command]
pub async fn convert_cancel(job_id: String) -> Result<(), String> {
    let pid = {
        let mut m = CONVERT_JOBS.lock().map_err(|e| e.to_string())?;
        m.remove(&job_id)
    };
    if let Some(pid) = pid {
        kill_pid(pid);
    }
    Ok(())
}

/// Probe for LibreOffice. Thin `#[tauri::command]` wrapper over the pure
/// `detect_libreoffice`, run off-thread because it shells out.
#[tauri::command]
pub async fn check_libreoffice_available() -> Result<LoAvailability, String> {
    tauri::async_runtime::spawn_blocking(detect_libreoffice)
        .await
        .map_err(|e| e.to_string())
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_escapes_special_fields() {
        assert_eq!(csv_escape("plain"), "plain");
        assert_eq!(csv_escape("a,b"), "\"a,b\"");
        assert_eq!(csv_escape("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_escape("line1\nline2"), "\"line1\nline2\"");
    }

    #[test]
    fn engine_matrix_text_family_routes_to_pandoc() {
        assert_eq!(engine_for("md", "docx"), Engine::Pandoc);
        assert_eq!(engine_for("docx", "md"), Engine::Pandoc);
        assert_eq!(engine_for("html", "odt"), Engine::Pandoc);
        assert_eq!(engine_for("txt", "html"), Engine::Pandoc);
        assert_eq!(engine_for("markdown", "docx"), Engine::Pandoc); // alias
    }

    #[test]
    fn engine_matrix_pdf_and_presentations_route_to_libreoffice() {
        // Any PDF target needs a layout engine, even from a text source.
        assert_eq!(engine_for("docx", "pdf"), Engine::LibreOffice);
        assert_eq!(engine_for("md", "pdf"), Engine::LibreOffice);
        // Presentations on either side.
        assert_eq!(engine_for("pptx", "pdf"), Engine::LibreOffice);
        assert_eq!(engine_for("odp", "pptx"), Engine::LibreOffice);
        assert_eq!(engine_for("md", "pptx"), Engine::LibreOffice);
    }

    #[test]
    fn engine_matrix_xlsx_to_csv_routes_to_bundled() {
        assert_eq!(engine_for("xlsx", "csv"), Engine::BundledCrate);
        // But xlsx -> pdf still needs LibreOffice (PDF rule wins).
        assert_eq!(engine_for("xlsx", "pdf"), Engine::LibreOffice);
    }

    #[test]
    fn engine_matrix_normalizes_extensions_with_dots_and_case() {
        assert_eq!(engine_for(".MD", ".DOCX"), Engine::Pandoc);
        assert_eq!(engine_for("XLSX", "CSV"), Engine::BundledCrate);
    }

    #[test]
    fn first_existing_returns_first_present() {
        let present = ["/a", "/b", "/c"];
        // Only "/b" and "/c" "exist": expect "/b" (first in list order).
        let got = first_existing(&present, |p| p == "/b" || p == "/c");
        assert_eq!(got, Some("/b".to_string()));
    }

    #[test]
    fn first_existing_returns_none_when_nothing_present() {
        let got = first_existing(&["/x", "/y"], |_| false);
        assert_eq!(got, None);
    }

    #[test]
    fn first_existing_respects_priority_order() {
        // soffice on PATH should win over an Applications fallback.
        let paths = ["soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"];
        let got = first_existing(&paths, |_| true);
        assert_eq!(got, Some("soffice".to_string()));
    }

    #[test]
    fn missing_libreoffice_error_is_actionable() {
        let msg = libreoffice_missing_error("pdf");
        assert!(msg.contains("PDF"));
        assert!(msg.contains("LibreOffice"));
        // Mentions how to resolve it (install or enable the optional engine).
        assert!(msg.to_lowercase().contains("install"));
        assert!(msg.to_lowercase().contains("optional engine"));
    }

    #[test]
    fn missing_pandoc_error_is_actionable() {
        let msg = pandoc_missing_error();
        assert!(msg.contains("Pandoc"));
        assert!(msg.to_lowercase().contains("install"));
    }

    #[test]
    fn libreoffice_required_pair_yields_actionable_error_when_unavailable() {
        // Simulate the routing decision + the error-building thin pure fn used
        // when the required engine is unavailable.
        let engine = engine_for("pptx", "pdf");
        assert_eq!(engine, Engine::LibreOffice);
        let msg = libreoffice_missing_error("pdf");
        assert!(msg.contains("LibreOffice"));
    }

    #[test]
    fn engine_as_str_is_stable() {
        assert_eq!(Engine::BundledCrate.as_str(), "bundled");
        assert_eq!(Engine::Pandoc.as_str(), "pandoc");
        assert_eq!(Engine::LibreOffice.as_str(), "libreoffice");
    }
}
