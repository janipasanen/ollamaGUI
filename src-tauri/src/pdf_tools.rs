//! PDF create + extract (#143).
//!
//! Bundled, offline PDF operations backed by the pure-Rust `lopdf` crate:
//!   - `document_pdf_extract`  — text extraction with no external tool.
//!   - `document_pdf_create`   — generate a text PDF from a spec.
//!   - `document_pdf_merge`    — stitch several PDFs into one.
//!   - `document_pdf_split`    — split by page ranges.
//!   - `document_pdf_info`     — page count + has-text (Poppler when present,
//!     lopdf fallback so it works with no external tool).
//!
//! PDF is scoped to CREATE-OR-EXTRACT, explicitly NOT in-place round-trip edit.
//! High-fidelity docx/html→PDF export routes through the tiered converter
//! (LibreOffice, CONDITIONAL). Scanned-PDF OCR is out of scope.

use serde::Serialize;
use std::collections::BTreeMap;
use std::process::Command;

use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document, Object, ObjectId, Stream};

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

// ---------------------------------------------------------------------------
// lopdf-backed generation / extraction (pure Rust, offline)
// ---------------------------------------------------------------------------

/// Build an in-memory single-or-multi-line text PDF (A4) from `text`.
///
/// Each `\n` starts a new line; the page uses the standard Helvetica font so the
/// produced text is extractable by `extract_text` and external readers.
pub fn build_text_pdf(text: &str) -> Result<Document, String> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });
    let resources_id = doc.add_object(dictionary! {
        "Font" => dictionary! { "F1" => font_id },
    });

    // One Td per line, stepping down the page by the leading.
    let leading = 14.0_f32;
    let mut ops: Vec<Operation> = vec![
        Operation::new("BT", vec![]),
        Operation::new("Tf", vec!["F1".into(), 12.into()]),
        Operation::new("Td", vec![50.into(), 780.into()]),
    ];
    let mut first = true;
    for line in text.split('\n') {
        if !first {
            ops.push(Operation::new("Td", vec![0.into(), (-leading).into()]));
        }
        first = false;
        ops.push(Operation::new("Tj", vec![Object::string_literal(line.as_bytes().to_vec())]));
    }
    ops.push(Operation::new("ET", vec![]));

    let content = Content { operations: ops };
    let content_id = doc.add_object(Stream::new(
        dictionary! {},
        content.encode().map_err(|e| e.to_string())?,
    ));

    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "Contents" => content_id,
    });

    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => vec![page_id.into()],
        "Count" => 1,
        "Resources" => resources_id,
        "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);
    doc.compress();
    Ok(doc)
}

/// Extract all text from a PDF (bundled, no external tool).
#[tauri::command]
pub async fn document_pdf_extract(path: String) -> Result<String, String> {
    let abs = resolve_workspace_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let doc = Document::load(&abs).map_err(|e| format!("Failed to open PDF: {e}"))?;
        let pages: Vec<u32> = doc.get_pages().keys().copied().collect();
        doc.extract_text(&pages).map_err(|e| format!("Text extraction failed: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Generate a text PDF at `path` from a plain-text / markdown spec.
#[tauri::command]
pub async fn document_pdf_create(path: String, text: String) -> Result<(), String> {
    let abs = resolve_workspace_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut doc = build_text_pdf(&text)?;
        doc.save(&abs).map_err(|e| format!("Failed to write PDF: {e}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Merge multiple PDFs (in order) into a single output file using lopdf.
///
/// Each input document's objects are renumbered into a shared id space, all
/// pages are collected under a fresh `/Pages` tree, and a new catalog is written.
#[tauri::command]
pub async fn document_pdf_merge(paths: Vec<String>, out: String) -> Result<(), String> {
    let abs_paths: Vec<_> = paths.iter().map(|p| resolve_workspace_path(p)).collect::<Result<_, _>>()?;
    let abs_out = resolve_workspace_path(&out)?;
    if abs_paths.is_empty() {
        return Err("No input PDFs to merge.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || merge_pdfs(&abs_paths, &abs_out))
        .await
        .map_err(|e| e.to_string())?
}

fn merge_pdfs(paths: &[std::path::PathBuf], out: &std::path::Path) -> Result<(), String> {
    let mut max_id = 1u32;
    let mut merged = Document::with_version("1.5");
    let mut page_ids: Vec<ObjectId> = Vec::new();
    let mut all_objects: BTreeMap<ObjectId, Object> = BTreeMap::new();

    for path in paths {
        let mut doc = Document::load(path).map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;
        for object_id in doc.get_pages().into_values() {
            page_ids.push(object_id);
        }
        all_objects.extend(doc.objects);
    }

    // Fresh /Pages node parenting every collected page.
    let pages_id = (max_id, 0);
    for pid in &page_ids {
        if let Some(Object::Dictionary(dict)) = all_objects.get_mut(pid) {
            dict.set("Parent", pages_id);
        }
    }
    let count = page_ids.len() as i64;
    let kids: Vec<Object> = page_ids.iter().map(|id| Object::Reference(*id)).collect();
    let pages_dict = dictionary! {
        "Type" => "Pages",
        "Kids" => kids,
        "Count" => count,
    };

    for (id, obj) in all_objects {
        merged.objects.insert(id, obj);
    }
    merged.objects.insert(pages_id, Object::Dictionary(pages_dict));
    let catalog_id = merged.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    merged.trailer.set("Root", catalog_id);
    merged.max_id = merged.objects.keys().map(|(i, _)| *i).max().unwrap_or(0);
    merged.renumber_objects();
    merged.compress();
    merged.save(out).map_err(|e| format!("Failed to write merged PDF: {e}"))?;
    Ok(())
}

/// Split a PDF into multiple files by page ranges (e.g. `"1-3,5"`), one output
/// file per range. Returns the list of written file paths.
#[tauri::command]
pub async fn document_pdf_split(
    path: String,
    ranges: String,
    out_dir: String,
) -> Result<Vec<String>, String> {
    let abs = resolve_workspace_path(&path)?;
    let abs_dir = resolve_workspace_path(&out_dir)?;
    let parsed = parse_ranges(&ranges);
    if parsed.is_empty() {
        return Err(format!("No valid page ranges in '{ranges}'."));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut written = Vec::new();
        for (idx, (start, end)) in parsed.iter().enumerate() {
            let mut doc = Document::load(&abs).map_err(|e| format!("Failed to open PDF: {e}"))?;
            let total = doc.get_pages().len() as u32;
            let lo = (*start).max(1);
            let hi = (*end).min(total);
            let keep: std::collections::HashSet<u32> = (lo..=hi).collect();
            let delete: Vec<u32> = (1..=total).filter(|p| !keep.contains(p)).collect();
            doc.delete_pages(&delete);
            let out_path = abs_dir.join(format!("split_{}_{}-{}.pdf", idx + 1, lo, hi));
            doc.save(&out_path).map_err(|e| format!("Failed to write split: {e}"))?;
            written.push(out_path.to_string_lossy().into_owned());
        }
        Ok::<Vec<String>, String>(written)
    })
    .await
    .map_err(|e| e.to_string())?
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

    // ----- lopdf round-trip tests -------------------------------------------

    #[test]
    fn generate_then_extract_roundtrips_text() {
        let mut doc = build_text_pdf("Hello PDF world").expect("build");
        let mut buf = Vec::new();
        doc.save_to(&mut buf).expect("save to buffer");
        let loaded = Document::load_mem(&buf).expect("reload");
        let pages: Vec<u32> = loaded.get_pages().keys().copied().collect();
        let text = loaded.extract_text(&pages).expect("extract");
        assert!(text.contains("Hello PDF world"), "extracted: {text:?}");
    }

    #[test]
    fn merge_two_single_page_pdfs_yields_two_pages() {
        let dir = std::env::temp_dir();
        let a = dir.join("lopdf_merge_a.pdf");
        let b = dir.join("lopdf_merge_b.pdf");
        let out = dir.join("lopdf_merge_out.pdf");
        build_text_pdf("Page A").unwrap().save(&a).unwrap();
        build_text_pdf("Page B").unwrap().save(&b).unwrap();
        merge_pdfs(&[a.clone(), b.clone()], &out).expect("merge");
        let merged = Document::load(&out).expect("load merged");
        assert_eq!(merged.get_pages().len(), 2);
        let _ = std::fs::remove_file(&a);
        let _ = std::fs::remove_file(&b);
        let _ = std::fs::remove_file(&out);
    }
}
