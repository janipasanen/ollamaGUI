//! OpenDocument Format (ODF) read / create / edit support (#142).
//!
//! ODF files (`.odt`, `.ods`, `.odp`) are ZIP archives of XML. The body lives in
//! `content.xml`, styles in `styles.xml`, and the package type is declared by a
//! `mimetype` entry that — per the ODF spec (OpenDocument §3.3, "Zip File
//! Structure") — **MUST be the FIRST entry in the archive and stored
//! UNCOMPRESSED** (ZIP `Stored` method, no extra field). This lets readers sniff
//! the package type from a fixed byte offset without inflating anything.
//!
//! This module implements the *surgical edit* path entirely with the crates we
//! already depend on (`zip` + `quick-xml`):
//!   * [`odf_unpack`] / [`odf_repack`] round-trip the archive while preserving
//!     entry order and re-asserting the mimetype-first-stored invariant.
//!   * [`odf_edit_text`] coalesces visible text across `<text:p>` / `<text:span>`
//!     (odt) and table-cell (ods) nodes, then performs a unique-match
//!     find/replace, failing loud on fragmentation or ambiguity — the same
//!     contract as an OOXML surgical edit.
//!   * [`odt_surgical_edit`] wires unpack → edit → repack together.
//!   * [`document_odf_edit`] is the Tauri command, workspace-scoped via
//!     `resolve_workspace_path`.
//!
//! Full-fidelity *read* and *create* (round-tripping styles, lists, tables) is
//! delegated to Pandoc, and `.odp` authoring to LibreOffice (`soffice`); those
//! runtime-dependent paths are out of scope here (see crate-level DEFERRED notes
//! in the issue) — this module provides the lossless byte-level edit primitive.

use serde::Serialize;
use std::io::{Cursor, Read, Write};

use quick_xml::events::Event;
use quick_xml::Reader;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// The canonical mimetype entry name. Must be the first archive member, stored.
const MIMETYPE_ENTRY: &str = "mimetype";

/// Result of a surgical ODF edit, returned to the frontend.
#[derive(Serialize)]
pub struct EditResult {
    /// A short, human-readable preview of the changed region (the replacement
    /// text in context) — empty when nothing changed.
    pub preview_text: String,
    /// Whether the file content actually changed.
    pub changed: bool,
}

// ─── ZIP round-trip ──────────────────────────────────────────────────────────

/// Read every entry of an ODF (zip) archive into `(name, bytes)` pairs,
/// **preserving the on-disk entry order**. Order matters because the ODF spec
/// requires `mimetype` to be the first entry; we must not reshuffle members we
/// don't understand (e.g. `Thumbnails/`, `META-INF/manifest.xml`).
pub fn odf_unpack(bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut zip = ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("Not a valid ODF/zip archive: {e}"))?;
    let mut parts = Vec::with_capacity(zip.len());
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry {i}: {e}"))?;
        // Skip directory entries; ODF packages store explicit folders but a
        // round-trip via start_file recreates the needed paths implicitly.
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut buf)
            .map_err(|e| format!("Failed to read entry '{name}': {e}"))?;
        parts.push((name, buf));
    }
    Ok(parts)
}

/// Re-pack `(name, bytes)` parts into a valid ODF archive.
///
/// The `mimetype` entry is written **first** and **STORED (uncompressed)**, as
/// the ODF spec mandates; every other entry is DEFLATED to keep the file small.
/// If the input parts already contain a `mimetype` entry (the normal case after
/// [`odf_unpack`]) it is hoisted to the front regardless of its original index;
/// the remaining entries keep their relative order.
pub fn odf_repack(parts: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);

        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let deflated =
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        // 1) mimetype FIRST, STORED. Locate it among the parts (it need not be
        //    first in the input vec, though after odf_unpack it usually is).
        if let Some((name, data)) = parts.iter().find(|(n, _)| n == MIMETYPE_ENTRY) {
            zip.start_file(name.as_str(), stored)
                .map_err(|e| format!("Failed to start mimetype entry: {e}"))?;
            zip.write_all(data)
                .map_err(|e| format!("Failed to write mimetype: {e}"))?;
        }

        // 2) Every other entry, DEFLATED, in original order.
        for (name, data) in parts.iter() {
            if name == MIMETYPE_ENTRY {
                continue;
            }
            zip.start_file(name.as_str(), deflated)
                .map_err(|e| format!("Failed to start entry '{name}': {e}"))?;
            zip.write_all(data)
                .map_err(|e| format!("Failed to write entry '{name}': {e}"))?;
        }

        zip.finish()
            .map_err(|e| format!("Failed to finalize ODF archive: {e}"))?;
    }
    Ok(cursor.into_inner())
}

// ─── Surgical text edit ──────────────────────────────────────────────────────

/// One run of visible text plus the exact byte span it occupies in the source
/// XML. We track spans so the replacement can be spliced back losslessly,
/// without re-serializing (and thus mangling) the surrounding markup.
struct TextRun {
    /// Unescaped, human-visible text of this run.
    text: String,
    /// Byte range `[start, end)` of the *raw* (still-escaped) text in the source.
    start: usize,
    end: usize,
}

/// Collect the visible text runs of an ODF `content.xml`.
///
/// We treat the document as a stream of text nodes. For each `Event::Text` we
/// recover the exact byte span of its *raw* (still-escaped) content in the
/// source string, so the replacement can later be spliced back without touching
/// surrounding markup. quick-xml's slice reader leaves `buffer_position()`
/// pointing at the byte just past the text content (i.e. the next `<`); the raw
/// text length is `e.len()` (BytesText derefs to the raw `&[u8]`), so the span
/// is `[end - raw_len, end)`. Computing the span from the *end* avoids the
/// `InsideMarkup` off-by-one that the start position is subject to.
///
/// Text-node collection is namespace-agnostic, so this works for both `text:`
/// (odt paragraphs/spans) and `table:` (ods cells) without hard-coding prefixes.
fn collect_text_runs(content_xml: &str) -> Result<Vec<TextRun>, String> {
    let mut reader = Reader::from_str(content_xml);
    let config = reader.config_mut();
    config.trim_text(false);

    let mut runs: Vec<TextRun> = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Text(e)) => {
                let end = reader.buffer_position() as usize;
                let raw_len = e.len();
                let start = end.saturating_sub(raw_len);
                // `e` borrows the still-escaped slice; unescape for matching.
                let unescaped = e
                    .unescape()
                    .map_err(|err| format!("XML unescape error: {err}"))?
                    .into_owned();
                if !unescaped.is_empty() {
                    runs.push(TextRun {
                        text: unescaped,
                        start,
                        end,
                    });
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
    }
    Ok(runs)
}

/// Surgically replace `find` with `replace` inside an ODF `content.xml`.
///
/// Contract (mirrors the OOXML surgical-edit primitive):
///   * `find` must match the **coalesced visible text** exactly once. We first
///     try to locate `find` wholly inside a single text run (the lossless, safe
///     case) and splice the replacement into that run's source span.
///   * If `find` does not appear in any single run but *does* appear in the
///     concatenated visible text, the match is **fragmented** across multiple
///     XML nodes (e.g. split by a `<text:span>` boundary). We refuse such edits
///     and return an error rather than risk corrupting markup — the caller must
///     narrow the match.
///   * Zero matches → error. More than one single-run match → ambiguous → error.
///
/// On success returns the rewritten XML string.
pub fn odf_edit_text(content_xml: &str, find: &str, replace: &str) -> Result<String, String> {
    if find.is_empty() {
        return Err("find string must not be empty.".to_string());
    }

    let runs = collect_text_runs(content_xml)?;

    // Pass 1: how many runs contain `find` as a substring of their visible text?
    let mut hits: Vec<&TextRun> = runs.iter().filter(|r| r.text.contains(find)).collect();

    if hits.len() == 1 {
        let run = hits.remove(0);
        // The run may contain `find` more than once; that is still ambiguous.
        let occurrences = run.text.matches(find).count();
        if occurrences > 1 {
            return Err(format!(
                "Ambiguous edit: '{find}' occurs {occurrences} times within a single text node — provide more surrounding context to make the match unique."
            ));
        }
        // Splice in the source: re-escape the replacement, substitute within the
        // raw slice. We operate on the raw (escaped) source slice so entities in
        // untouched parts of the run survive verbatim.
        let raw_slice = &content_xml[run.start..run.end];
        let escaped_find = xml_escape(find);
        let escaped_replace = xml_escape(replace);

        // Prefer matching the escaped form (handles `&amp;`, `&lt;` etc.); fall
        // back to the literal form for runs with no entities.
        let new_slice = if raw_slice.contains(&escaped_find) {
            raw_slice.replacen(&escaped_find, &escaped_replace, 1)
        } else if raw_slice.contains(find) {
            raw_slice.replacen(find, &escaped_replace, 1)
        } else {
            // Visible text matched but neither escaped nor literal form is found
            // in the raw slice — the run is itself internally fragmented.
            return Err(format!(
                "Fragmented edit: '{find}' spans entity/markup boundaries within a node and cannot be safely replaced."
            ));
        };

        let mut out = String::with_capacity(content_xml.len() + escaped_replace.len());
        out.push_str(&content_xml[..run.start]);
        out.push_str(&new_slice);
        out.push_str(&content_xml[run.end..]);
        return Ok(out);
    }

    if hits.len() > 1 {
        return Err(format!(
            "Ambiguous edit: '{find}' matches {} separate text nodes — provide more context to make the match unique.",
            hits.len()
        ));
    }

    // Pass 2: no single run matched. Is it fragmented across runs?
    let coalesced: String = runs.iter().map(|r| r.text.as_str()).collect();
    if coalesced.contains(find) {
        return Err(format!(
            "Fragmented edit: '{find}' is split across multiple XML nodes (e.g. <text:span> boundaries) and cannot be replaced surgically — narrow the match to text within a single run."
        ));
    }

    Err(format!("Edit failed: '{find}' not found in document text."))
}

/// Minimal XML text-content escaper (matches what ODF writers emit for text
/// nodes). Only the three characters that are significant inside element text
/// need escaping; quotes are only significant in attributes.
fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            c => out.push(c),
        }
    }
    out
}

/// Full unpack → edit `content.xml` → repack pipeline for an ODF file.
///
/// Preserves the mimetype-first-stored invariant via [`odf_repack`]. Only
/// `content.xml` is touched; all other package members round-trip unchanged.
pub fn odt_surgical_edit(file_bytes: &[u8], find: &str, replace: &str) -> Result<Vec<u8>, String> {
    let mut parts = odf_unpack(file_bytes)?;

    let content_idx = parts
        .iter()
        .position(|(name, _)| name == "content.xml")
        .ok_or_else(|| "ODF package has no content.xml.".to_string())?;

    let original = String::from_utf8(parts[content_idx].1.clone())
        .map_err(|e| format!("content.xml is not valid UTF-8: {e}"))?;

    let edited = odf_edit_text(&original, find, replace)?;
    parts[content_idx].1 = edited.into_bytes();

    odf_repack(&parts)
}

// ─── Tauri command ───────────────────────────────────────────────────────────

/// Surgically find/replace text inside an ODF document (`.odt` / `.ods` /
/// `.odp`) and write the result back to disk. Workspace-scoped.
///
/// All three ODF flavours share the `content.xml` body, so a single routine
/// handles them; the extension is validated to give a clear error for non-ODF
/// inputs.
#[tauri::command]
pub async fn document_odf_edit(
    path: String,
    find: String,
    replace: String,
) -> Result<EditResult, String> {
    let abs = crate::resolve_workspace_path(&path)?;

    tauri::async_runtime::spawn_blocking(move || {
        let lower = path.to_lowercase();
        if !(lower.ends_with(".odt") || lower.ends_with(".ods") || lower.ends_with(".odp")) {
            return Err(format!(
                "Unsupported file type for ODF edit: '{path}' (expected .odt/.ods/.odp)."
            ));
        }

        let bytes = std::fs::read(&abs).map_err(|e| format!("Failed to read '{path}': {e}"))?;
        let new_bytes = odt_surgical_edit(&bytes, &find, &replace)?;

        std::fs::write(&abs, &new_bytes)
            .map_err(|e| format!("Failed to write '{path}': {e}"))?;

        // Build a short preview centred on the replacement text.
        let preview = build_preview(&replace);
        Ok(EditResult {
            preview_text: preview,
            changed: true,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Trim the replacement to a bounded preview snippet for the UI.
fn build_preview(replace: &str) -> String {
    const MAX: usize = 200;
    if replace.chars().count() <= MAX {
        replace.to_string()
    } else {
        let truncated: String = replace.chars().take(MAX).collect();
        format!("{truncated}…")
    }
}

// ─── ODS read via calamine (#142) ────────────────────────────────────────────

/// Render a calamine cell range as a GitHub-flavoured markdown table. The first
/// row is treated as the header.
pub fn range_to_markdown(range: &calamine::Range<calamine::Data>) -> String {
    let mut out = String::new();
    let mut rows = range.rows();
    if let Some(header) = rows.next() {
        let cells: Vec<String> = header.iter().map(|c| c.to_string()).collect();
        out.push_str(&format!("| {} |\n", cells.join(" | ")));
        out.push_str(&format!("|{}|\n", vec![" --- "; cells.len().max(1)].join("|")));
        for row in rows {
            let cells: Vec<String> = row.iter().map(|c| c.to_string()).collect();
            out.push_str(&format!("| {} |\n", cells.join(" | ")));
        }
    }
    out
}

/// Read an `.ods` spreadsheet into markdown tables (one section per sheet),
/// offline via the pure-Rust `calamine` reader (#142).
#[tauri::command]
pub async fn document_ods_read(path: String) -> Result<String, String> {
    use calamine::{open_workbook, Ods, Reader};
    let abs = crate::resolve_workspace_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut wb: Ods<_> = open_workbook(&abs).map_err(|e| format!("Failed to open ods: {e}"))?;
        let names = wb.sheet_names();
        let mut md = String::new();
        for name in names {
            let range = wb
                .worksheet_range(&name)
                .map_err(|e| format!("Failed to read sheet '{name}': {e}"))?;
            md.push_str(&format!("## {name}\n\n"));
            md.push_str(&range_to_markdown(&range));
            md.push('\n');
        }
        Ok::<String, String>(md)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    // `super::*` already brings Write, Cursor, ZipWriter, etc. into scope.
    use super::*;

    /// The official mimetype string for an OpenDocument Text package.
    const ODT_MIME: &str = "application/vnd.oasis.opendocument.text";

    /// Build a minimal valid `.odt` byte stream in memory: `mimetype` first and
    /// STORED, then a `content.xml` holding a single paragraph.
    fn build_minimal_odt(paragraph: &str) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut cursor);
            let stored =
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
            let deflated =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

            zip.start_file("mimetype", stored).unwrap();
            zip.write_all(ODT_MIME.as_bytes()).unwrap();

            let content = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>{paragraph}</text:p></office:text></office:body></office:document-content>"#
            );
            zip.start_file("content.xml", deflated).unwrap();
            zip.write_all(content.as_bytes()).unwrap();

            zip.finish().unwrap();
        }
        cursor.into_inner()
    }

    /// Re-read a produced archive and return (name, compression) per entry, in
    /// order, so tests can assert the mimetype-first-stored invariant.
    fn entry_summary(bytes: &[u8]) -> Vec<(String, CompressionMethod)> {
        let mut zip = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut out = Vec::new();
        for i in 0..zip.len() {
            let e = zip.by_index(i).unwrap();
            out.push((e.name().to_string(), e.compression()));
        }
        out
    }

    #[test]
    fn unpack_preserves_order_and_content() {
        let odt = build_minimal_odt("Hello");
        let parts = odf_unpack(&odt).unwrap();
        // mimetype must come before content.xml.
        assert_eq!(parts[0].0, "mimetype");
        assert_eq!(parts[0].1, ODT_MIME.as_bytes());
        assert!(parts.iter().any(|(n, _)| n == "content.xml"));
    }

    #[test]
    fn repack_writes_mimetype_first_and_stored() {
        let odt = build_minimal_odt("Hello");
        let parts = odf_unpack(&odt).unwrap();
        let repacked = odf_repack(&parts).unwrap();

        let summary = entry_summary(&repacked);
        // (a) first entry is mimetype
        assert_eq!(summary[0].0, "mimetype");
        // (b) it is Stored, not Deflated
        assert_eq!(summary[0].1, CompressionMethod::Stored);
        // sanity: content.xml exists and is deflated
        let content = summary.iter().find(|(n, _)| n == "content.xml").unwrap();
        assert_eq!(content.1, CompressionMethod::Deflated);
    }

    #[test]
    fn repack_hoists_mimetype_even_if_not_first_in_parts() {
        // Construct parts deliberately out of order.
        let parts = vec![
            ("content.xml".to_string(), b"<x/>".to_vec()),
            ("mimetype".to_string(), ODT_MIME.as_bytes().to_vec()),
        ];
        let repacked = odf_repack(&parts).unwrap();
        let summary = entry_summary(&repacked);
        assert_eq!(summary[0].0, "mimetype");
        assert_eq!(summary[0].1, CompressionMethod::Stored);
    }

    #[test]
    fn edit_only_changes_content_xml_bytes() {
        let odt = build_minimal_odt("Hello");
        let edited = odt_surgical_edit(&odt, "Hello", "World").unwrap();

        let before = odf_unpack(&odt).unwrap();
        let after = odf_unpack(&edited).unwrap();

        for (b, a) in before.iter().zip(after.iter()) {
            assert_eq!(b.0, a.0, "entry order/names must be preserved");
            if a.0 == "content.xml" {
                assert_ne!(b.1, a.1, "content.xml bytes must change");
                let txt = String::from_utf8(a.1.clone()).unwrap();
                assert!(txt.contains("World"));
                assert!(!txt.contains("Hello"));
            } else {
                // (c) every other entry's bytes must be byte-identical.
                assert_eq!(b.1, a.1, "non-content entry '{}' must not change", a.0);
            }
        }
    }

    #[test]
    fn edit_single_paragraph_succeeds() {
        let content = r#"<office:body><text:p>The quick brown fox</text:p></office:body>"#;
        let out = odf_edit_text(content, "quick brown", "slow red").unwrap();
        assert!(out.contains("The slow red fox"));
        assert!(!out.contains("quick brown"));
    }

    #[test]
    fn edit_table_cell_text_succeeds() {
        // ods-style cell content; local-name matching means we don't special-case
        // table namespaces — we just match the visible text run.
        let content = r#"<table:table-cell><text:p>Revenue</text:p></table:table-cell>"#;
        let out = odf_edit_text(content, "Revenue", "Income").unwrap();
        assert!(out.contains("Income"));
        assert!(!out.contains("Revenue"));
    }

    #[test]
    fn fragmented_match_returns_err_and_no_change() {
        // "Hello World" is split across two <text:span> nodes — must fail loud.
        let content =
            r#"<text:p><text:span>Hello </text:span><text:span>World</text:span></text:p>"#;
        let result = odf_edit_text(content, "Hello World", "Goodbye");
        assert!(result.is_err(), "fragmented match must error");
        let msg = result.unwrap_err();
        assert!(
            msg.contains("Fragmented"),
            "error should explain fragmentation, got: {msg}"
        );
    }

    #[test]
    fn ambiguous_match_across_nodes_returns_err() {
        let content =
            r#"<text:p><text:span>cat</text:span></text:p><text:p><text:span>cat</text:span></text:p>"#;
        let result = odf_edit_text(content, "cat", "dog");
        assert!(result.is_err(), "two-node match must be ambiguous");
        assert!(result.unwrap_err().contains("Ambiguous"));
    }

    #[test]
    fn missing_text_returns_err() {
        let content = r#"<text:p>Hello</text:p>"#;
        let result = odf_edit_text(content, "Goodbye", "Hi");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn edit_preserves_surrounding_entities() {
        // The replacement must be re-escaped; untouched entities survive.
        let content = r#"<text:p>A &amp; B target C</text:p>"#;
        let out = odf_edit_text(content, "target", "x < y & z").unwrap();
        assert!(out.contains("A &amp; B"), "untouched entity preserved");
        assert!(out.contains("x &lt; y &amp; z"), "replacement re-escaped");
    }
}
