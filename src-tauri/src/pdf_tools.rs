//! PDF create + extract command surface (#143).
//!
//! This module exposes a small, dependency-free PDF command surface that mirrors
//! the rest of the multi-format document I/O work (#139-#145). It deliberately
//! shells out to the Poppler utilities (`pdfinfo`, `pdftotext`) that ship with
//! most desktop installs rather than pulling heavy Rust PDF crates into the
//! build. Everything degrades gracefully: if the tools are absent we return
//! a benign "no info" result instead of an error.
//!
//! DEFERRED (needs crates `pdf-extract` / `printpdf` / `lopdf`):
//!   - Bundled (no external tool) text extraction and PDF generation.
//!   - `document_pdf_merge` / `document_pdf_split` real implementations.
//! The signatures and registration for merge/split exist here so the command
//! surface is stable; the bodies return a clear "deferred" error until the
//! `lopdf` crate is approved (see manifest.deferred and the Cargo.toml
//! sharedEdit marked DEFERRED).

use serde::Serialize;
use std::process::Command;

use crate::resolve_workspace_path;

/// Result of probing a PDF for page count and whether it contains extractable text.
#[derive(Debug, Serialize)]
pub struct PdfInfo {
    /// Number of pages. 0 when no tool could determine it.
    pub pages: u32,
    /// True when the PDF yields non-whitespace text (i.e. it is not a pure scan).
    pub has_text: bool,
}

// ---------------------------------------------------------------------------
// Pure, testable helpers
// ---------------------------------------------------------------------------

/// Parse the `Pages: N` line out of `pdfinfo` stdout.
///
/// `pdfinfo` prints a block of `Key:    Value` lines; we only care about the
/// page count. Returns 0 if the line is missing or unparseable.
pub fn parse_pdfinfo_pages(stdout: &str) -> u32 {
    for line in stdout.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("Pages:") {
            if let Ok(n) = rest.trim().parse::<u32>() {
                return n;
            }
        }
    }
    0
}

/// Count pages from `pdftotext - output` by counting form-feed (`\x0c`)
/// separators. Poppler emits one form-feed *after* each page, so the number of
/// pages is the number of form-feeds (a non-empty document with no trailing
/// form-feed still has at least one page).
pub fn count_formfeed_pages(extracted: &str) -> u32 {
    let feeds = extracted.matches('\u{000c}').count() as u32;
    if feeds > 0 {
        feeds
    } else if extracted.trim().is_empty() {
        0
    } else {
        // Some builds omit the trailing form-feed for a single-page doc.
        1
    }
}

/// True when the extracted text contains any non-whitespace character.
pub fn detect_has_text(extracted: &str) -> bool {
    !extracted.trim().is_empty()
}

/// Parse a page-range spec like `"1-3,5"` into inclusive `(start, end)` pairs.
///
/// Rules:
///   - `"a-b"` -> `(a, b)` (kept as-is even if `a > b`; callers may validate).
///   - `"n"`   -> `(n, n)`.
///   - Whitespace around commas / hyphens is ignored.
///   - Empty / malformed segments are skipped silently.
///
/// Example: `parse_ranges("1-3,5")` -> `[(1, 3), (5, 5)]`.
pub fn parse_ranges(spec: &str) -> Vec<(u32, u32)> {
    let mut out = Vec::new();
    for raw in spec.split(',') {
        let seg = raw.trim();
        if seg.is_empty() {
            continue;
        }
        if let Some((a, b)) = seg.split_once('-') {
            match (a.trim().parse::<u32>(), b.trim().parse::<u32>()) {
                (Ok(start), Ok(end)) => out.push((start, end)),
                _ => continue,
            }
        } else if let Ok(n) = seg.trim().parse::<u32>() {
            out.push((n, n));
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Probe a PDF for its page count and whether it contains extractable text.
///
/// Strategy (each step optional, degrades gracefully):
///   1. `pdfinfo <path>` -> parse `Pages: N` for an exact page count.
///   2. `pdftotext <path> -` -> the extracted text determines `has_text`, and
///      also gives a fallback page count via form-feed counting when `pdfinfo`
///      is unavailable.
///
/// If neither tool is installed we return `{ pages: 0, has_text: false }`
/// rather than erroring — the caller can surface a "install Poppler" hint.
#[tauri::command]
pub async fn document_pdf_info(path: String) -> Result<PdfInfo, String> {
    let abs = resolve_workspace_path(&path)?;
    let path_str = abs.to_str().ok_or("Invalid path")?.to_string();

    tauri::async_runtime::spawn_blocking(move || {
        // Step 1: pdfinfo for an authoritative page count.
        let pages_from_info = Command::new("pdfinfo")
            .arg(&path_str)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| parse_pdfinfo_pages(&String::from_utf8_lossy(&o.stdout)))
            .unwrap_or(0);

        // Step 2: pdftotext for has_text + fallback page count.
        let extracted = Command::new("pdftotext")
            .arg(&path_str)
            .arg("-")
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default();

        let has_text = detect_has_text(&extracted);
        let pages = if pages_from_info > 0 {
            pages_from_info
        } else {
            count_formfeed_pages(&extracted)
        };

        PdfInfo { pages, has_text }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Merge multiple PDFs into a single output file.
///
/// DEFERRED (needs `lopdf`): real merging requires parsing and re-stitching the
/// PDF object graphs, which the bundled crates cannot do. The signature and
/// registration exist so the command surface is stable; the body returns a
/// clear error until `lopdf` is approved.
///
/// Reference implementation to drop in once the crate is added:
/// ```ignore
/// use lopdf::{Document, Object, ObjectId};
/// // load each Document, renumber objects, append page trees,
/// // rebuild the /Pages catalog, then doc.save(out)?;
/// ```
#[tauri::command]
pub async fn document_pdf_merge(paths: Vec<String>, out: String) -> Result<(), String> {
    // Resolve up-front so a bad path still reports a sensible error and the
    // surface behaves like the other filesystem-scoped commands.
    for p in &paths {
        resolve_workspace_path(p)?;
    }
    resolve_workspace_path(&out)?;
    Err("PDF merge/split needs the lopdf crate (deferred)".to_string())
}

/// Split a PDF into multiple files by page ranges (e.g. `"1-3,5"`).
///
/// DEFERRED (needs `lopdf`): see [`document_pdf_merge`]. Returns the list of
/// written file paths once implemented. The range parsing
/// ([`parse_ranges`]) is implemented and tested now so the routing logic is
/// ready for the crate spike.
#[tauri::command]
pub async fn document_pdf_split(
    path: String,
    ranges: String,
    out_dir: String,
) -> Result<Vec<String>, String> {
    resolve_workspace_path(&path)?;
    resolve_workspace_path(&out_dir)?;
    // Parse now so an obviously-malformed spec fails fast even before the crate
    // lands; an empty result means nothing valid was requested.
    let parsed = parse_ranges(&ranges);
    if parsed.is_empty() {
        return Err(format!("No valid page ranges in '{ranges}'."));
    }
    Err("PDF merge/split needs the lopdf crate (deferred)".to_string())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pages_line() {
        let stdout = "Title:          Report\nAuthor:         Jane\nPages:          12\nEncrypted:      no\n";
        assert_eq!(parse_pdfinfo_pages(stdout), 12);
    }

    #[test]
    fn parses_pages_with_extra_whitespace() {
        assert_eq!(parse_pdfinfo_pages("Pages:1\n"), 1);
        assert_eq!(parse_pdfinfo_pages("   Pages:   7  \n"), 7);
    }

    #[test]
    fn missing_pages_line_is_zero() {
        assert_eq!(parse_pdfinfo_pages("Title: X\nAuthor: Y\n"), 0);
        assert_eq!(parse_pdfinfo_pages(""), 0);
        assert_eq!(parse_pdfinfo_pages("Pages: not-a-number\n"), 0);
    }

    #[test]
    fn counts_formfeed_pages() {
        // Three pages -> three form-feeds in pdftotext output.
        assert_eq!(count_formfeed_pages("a\u{000c}b\u{000c}c\u{000c}"), 3);
        // Single page without a trailing form-feed still counts as one.
        assert_eq!(count_formfeed_pages("just one page"), 1);
        // Empty output -> zero pages.
        assert_eq!(count_formfeed_pages(""), 0);
        assert_eq!(count_formfeed_pages("   \n  "), 0);
    }

    #[test]
    fn detects_text_presence() {
        assert!(detect_has_text("hello"));
        assert!(detect_has_text("  word with spaces  "));
        assert!(!detect_has_text(""));
        assert!(!detect_has_text("   \n\t \u{000c} "));
    }

    #[test]
    fn parses_simple_ranges() {
        assert_eq!(parse_ranges("1-3,5"), vec![(1, 3), (5, 5)]);
    }

    #[test]
    fn parses_single_and_multi() {
        assert_eq!(parse_ranges("4"), vec![(4, 4)]);
        assert_eq!(parse_ranges("1-2,3-4,7"), vec![(1, 2), (3, 4), (7, 7)]);
    }

    #[test]
    fn ignores_whitespace_and_empties() {
        assert_eq!(parse_ranges(" 1 - 3 , 5 "), vec![(1, 3), (5, 5)]);
        assert_eq!(parse_ranges("1-3,,5,"), vec![(1, 3), (5, 5)]);
        assert_eq!(parse_ranges(""), Vec::<(u32, u32)>::new());
    }

    #[test]
    fn skips_malformed_segments() {
        // "abc" and "1-x" are dropped; the valid "2" survives.
        assert_eq!(parse_ranges("abc,1-x,2"), vec![(2, 2)]);
    }
}
