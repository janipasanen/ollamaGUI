//! Round-trip OOXML editing for docx/xlsx/pptx (#141).
//!
//! OOXML files (.docx/.xlsx/.pptx) are ZIP archives of XML parts. This module
//! provides a lossless unpack -> edit -> repack pipeline plus two edit
//! strategies, implemented with ONLY the `zip` and `quick-xml` crates that are
//! already present (no heavy document crates).
//!
//! Two edit paths are offered, in order of robustness:
//!
//!  1. **Template fill (PRIMARY).** The caller authors a document containing
//!     `{{placeholder}}` tokens and we substitute values, XML-escaping them.
//!     Because the author controls the markup, a placeholder lives inside a
//!     single text run and substitution is always safe and unambiguous. This is
//!     the recommended generation path.
//!
//!  2. **Surgical run replacement (BEST EFFORT).** For editing pre-existing
//!     documents we coalesce the logical text spread across adjacent run-text
//!     elements (`<w:t>` for Word, `<a:t>` for PowerPoint), search for a target
//!     string across run boundaries, and on a *unique* match rewrite the runs in
//!     place. Word in particular fragments a single visual word across many runs
//!     (spell-check state, rsid marks, formatting toggles), so a naive string
//!     replace on the raw XML usually fails — coalescing defeats that. When the
//!     match is absent, ambiguous, or still defeated by fragmentation we return
//!     an actionable `Err` and leave the document byte-for-byte unchanged.

use std::collections::HashMap;
use std::io::{Cursor, Read, Write};

use quick_xml::events::{BytesText, Event};
use quick_xml::{Reader, Writer};
use serde::Serialize;

// ─── ZIP container round-trip ────────────────────────────────────────────────

/// Read every entry of an OOXML/ZIP container into `(name, bytes)` pairs,
/// preserving archive order. Order matters: `[Content_Types].xml` and the
/// relationship parts are conventionally first, and some consumers are picky.
pub fn ooxml_unpack(bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let cursor = Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(cursor).map_err(|e| format!("zip open: {e}"))?;
    let mut parts: Vec<(String, Vec<u8>)> = Vec::with_capacity(zip.len());
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
        // Skip directory entries — they carry no content and the repack
        // re-creates the tree implicitly from file names.
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let mut data = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut data)
            .map_err(|e| format!("zip read {name}: {e}"))?;
        parts.push((name, data));
    }
    Ok(parts)
}

/// Write the given `(name, bytes)` parts into a fresh DEFLATED ZIP, preserving
/// order. An unedited `ooxml_unpack` -> `ooxml_repack` -> `ooxml_unpack`
/// round-trip yields a byte-identical parts vector (the *content* is lossless;
/// the raw zip bytes may differ in compression metadata, which is irrelevant to
/// OOXML consumers).
pub fn ooxml_repack(parts: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let mut buf: Vec<u8> = Vec::new();
    {
        let cursor = Cursor::new(&mut buf);
        let mut zip = zip::ZipWriter::new(cursor);
        // Deflated is the standard OOXML compression; default options are fine.
        let options =
            zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in parts {
            zip.start_file(name.as_str(), options)
                .map_err(|e| format!("zip start {name}: {e}"))?;
            zip.write_all(data).map_err(|e| format!("zip write {name}: {e}"))?;
        }
        zip.finish().map_err(|e| format!("zip finish: {e}"))?;
    }
    Ok(buf)
}

// ─── Template fill (PRIMARY edit path) ───────────────────────────────────────

/// Minimal XML escaping for substituted *text* values. Order matters: `&` must
/// be escaped first so we don't double-escape the entities we introduce.
fn xml_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Replace `{{key}}` placeholders in `part_xml` with XML-escaped values from
/// `data`. Placeholders whose key is absent from `data` are left untouched, so
/// repeated fills compose. This is a plain text scan over the XML string, which
/// is safe precisely because template authors keep each `{{key}}` inside one
/// text run (the document author controls the markup in the PRIMARY path).
pub fn template_fill(part_xml: &str, data: &HashMap<String, String>) -> String {
    let bytes = part_xml.as_bytes();
    let mut out = String::with_capacity(part_xml.len());
    let mut i = 0usize;
    while i < bytes.len() {
        // Look for the start of a placeholder "{{".
        if bytes[i] == b'{' && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
            // Find the closing "}}".
            if let Some(rel_end) = part_xml[i + 2..].find("}}") {
                let key = &part_xml[i + 2..i + 2 + rel_end];
                // A well-formed key is non-empty and contains no braces.
                if !key.is_empty() && !key.contains('{') && !key.contains('}') {
                    if let Some(value) = data.get(key.trim()) {
                        out.push_str(&xml_escape(value));
                        i = i + 2 + rel_end + 2; // skip past closing "}}"
                        continue;
                    }
                }
            }
        }
        // Default: copy the byte through. We index by char boundary safely by
        // copying the current char rather than a raw byte.
        let ch = part_xml[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

// ─── Surgical run replacement (BEST EFFORT edit path) ────────────────────────

/// A single run-text element captured during the coalescing pass.
struct RunText {
    /// Event index (into `events`) of this run-text `Start` element.
    start_idx: usize,
    /// The decoded (unescaped) logical text this run contributes.
    text: String,
    /// Character offset where this run's text begins in the coalesced string.
    char_start: usize,
}

/// Coalesce the text of adjacent run-text elements (local name == `run_tag`,
/// e.g. `b"t"` for both `<w:t>` and `<a:t>`), search for `find` across run
/// boundaries, and on a UNIQUE match rewrite in place: the entire replacement
/// goes into the first overlapped run and every other overlapped run is blanked.
///
/// Returns `Err` with an actionable message — and makes NO change — when the
/// match is absent, ambiguous (appears more than once), or the matched span
/// could not be cleanly attributed to runs (fragmentation defeated us).
///
/// The implementation streams events with quick-xml, buffering them so we can
/// (a) build the coalesced logical string for searching and (b) rewrite the
/// specific run-text `Text` events on a hit, re-serializing everything else
/// verbatim.
pub fn surgical_replace_runs(
    part_xml: &str,
    find: &str,
    replace: &str,
    run_tag: &[u8],
) -> Result<String, String> {
    if find.is_empty() {
        return Err("surgical edit: 'find' must not be empty".to_string());
    }

    let mut reader = Reader::from_str(part_xml);
    // We must NOT trim text — run text can be significant whitespace, and we
    // re-emit events verbatim to keep the part lossless.
    reader.config_mut().trim_text(false);

    // Buffer every event so we can do a two-pass (locate, then rewrite).
    let mut events: Vec<Event<'static>> = Vec::new();
    // Map each buffered run-text Start to the index of its following Text event
    // (if any). Built as we stream.
    let mut runs: Vec<RunText> = Vec::new();
    // The coalesced logical text across all run-text elements.
    let mut logical = String::new();
    // Are we currently inside a run-text element awaiting its Text event?
    let mut pending_run_start: Option<usize> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Eof) => break,
            Ok(ev) => {
                let owned = ev.into_owned();
                let idx = events.len();
                match &owned {
                    Event::Start(e) if e.local_name().as_ref() == run_tag => {
                        pending_run_start = Some(idx);
                    }
                    Event::Text(t) if pending_run_start.is_some() => {
                        let start_idx = pending_run_start.take().unwrap();
                        let decoded = t
                            .unescape()
                            .map_err(|e| format!("surgical edit: xml decode: {e}"))?
                            .into_owned();
                        let char_start = logical.chars().count();
                        logical.push_str(&decoded);
                        runs.push(RunText {
                            start_idx,
                            text: decoded,
                            char_start,
                        });
                    }
                    // An empty run-text (<w:t/> or <w:t></w:t> with no text) or
                    // any other element clears the pending state.
                    Event::End(e) if e.local_name().as_ref() == run_tag => {
                        pending_run_start = None;
                    }
                    _ => {}
                }
                events.push(owned);
            }
            Err(e) => return Err(format!("surgical edit: xml parse: {e}")),
        }
    }

    // Locate `find` in the coalesced logical text. We search by char index so
    // that offsets line up with the per-run `char_start` accounting.
    let logical_chars: Vec<char> = logical.chars().collect();
    let find_chars: Vec<char> = find.chars().collect();
    let matches = find_char_matches(&logical_chars, &find_chars);

    match matches.len() {
        0 => Err(format!(
            "surgical edit: '{find}' not found (it may be split across runs in a way text coalescing could not recover, or it is simply absent). No change made."
        )),
        1 => {
            let match_start = matches[0];
            let match_end = match_start + find_chars.len(); // exclusive, in chars
            apply_run_rewrite(&mut events, &runs, match_start, match_end, replace)?;
            // Re-serialize the (possibly mutated) event stream verbatim.
            serialize_events(&events)
        }
        n => Err(format!(
            "surgical edit: '{find}' is ambiguous — it occurs {n} times. Provide a longer, unique 'find' string. No change made."
        )),
    }
}

/// Find every starting char-index where `needle` occurs in `haystack`. Naive
/// scan — OOXML parts are small and this keeps the logic obvious.
fn find_char_matches(haystack: &[char], needle: &[char]) -> Vec<usize> {
    let mut hits = Vec::new();
    if needle.is_empty() || needle.len() > haystack.len() {
        return hits;
    }
    let last = haystack.len() - needle.len();
    let mut i = 0;
    while i <= last {
        if haystack[i..i + needle.len()] == *needle {
            hits.push(i);
            i += needle.len(); // non-overlapping — matters for ambiguity count
        } else {
            i += 1;
        }
    }
    hits
}

/// Rewrite the `Text` events of the runs overlapped by `[match_start, match_end)`
/// (char range over the coalesced logical string): the full `replace` text is
/// placed into the first overlapped run, and the overlapped portion of every
/// later run is removed. Portions of the first/last run that fall *outside* the
/// match are preserved.
fn apply_run_rewrite(
    events: &mut [Event<'static>],
    runs: &[RunText],
    match_start: usize,
    match_end: usize,
    replace: &str,
) -> Result<(), String> {
    // Identify the runs that the match overlaps.
    let mut overlapped: Vec<&RunText> = Vec::new();
    for r in runs {
        let r_start = r.char_start;
        let r_end = r.char_start + r.text.chars().count();
        if r_start < match_end && r_end > match_start {
            overlapped.push(r);
        }
    }
    if overlapped.is_empty() {
        // Should not happen given a valid match, but guard defensively.
        return Err(
            "surgical edit: matched text could not be attributed to any run (fragmentation defeated the edit). No change made."
                .to_string(),
        );
    }

    for (pos, r) in overlapped.iter().enumerate() {
        let r_chars: Vec<char> = r.text.chars().collect();
        let r_start = r.char_start;
        let r_end = r.char_start + r_chars.len();
        // The part of this run that precedes the match (kept verbatim).
        let prefix_end = match_start.saturating_sub(r_start).min(r_chars.len());
        let prefix: String = r_chars[..prefix_end].iter().collect();
        // The part of this run that follows the match (kept verbatim).
        let suffix_start = if match_end > r_start {
            (match_end - r_start).min(r_chars.len())
        } else {
            0
        };
        let suffix: String = if suffix_start < r_chars.len() {
            r_chars[suffix_start..].iter().collect()
        } else {
            String::new()
        };

        // First overlapped run carries the whole replacement; the rest drop the
        // matched span entirely.
        let new_text = if pos == 0 {
            format!("{prefix}{replace}{suffix}")
        } else {
            format!("{prefix}{suffix}")
        };

        // The Text event lives immediately after the run-text Start element.
        let text_idx = r.start_idx + 1;
        // BytesText::new escapes the text on serialization, so we pass the raw
        // logical string and quick-xml re-encodes the entities correctly.
        let owned = BytesText::new(&new_text).into_owned();
        events[text_idx] = Event::Text(owned);

        // Silence unused-binding warnings on the rare zero-length edges.
        let _ = r_end;
    }

    Ok(())
}

/// Re-serialize a buffered event stream back to an XML string verbatim.
fn serialize_events(events: &[Event<'static>]) -> Result<String, String> {
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    for ev in events {
        // `write_event` takes `impl Into<Event>`; a borrowed `&Event` does not
        // satisfy that bound, so hand it an owned clone of each buffered event.
        writer
            .write_event(ev.clone())
            .map_err(|e| format!("surgical edit: xml write: {e}"))?;
    }
    let bytes = writer.into_inner().into_inner();
    String::from_utf8(bytes).map_err(|e| format!("surgical edit: utf8: {e}"))
}

// ─── High-level format helpers ───────────────────────────────────────────────

/// The primary part path for each editable OOXML family.
const DOCX_MAIN: &str = "word/document.xml";

/// Run `template_fill` over `word/document.xml` and repack. Lossless for all
/// other parts.
pub fn docx_template_fill(file_bytes: &[u8], data: &HashMap<String, String>) -> Result<Vec<u8>, String> {
    let mut parts = ooxml_unpack(file_bytes)?;
    let mut found = false;
    for (name, data_bytes) in parts.iter_mut() {
        if name == DOCX_MAIN {
            let xml = String::from_utf8(std::mem::take(data_bytes))
                .map_err(|e| format!("{DOCX_MAIN} utf8: {e}"))?;
            *data_bytes = template_fill(&xml, data).into_bytes();
            found = true;
        }
    }
    if !found {
        return Err(format!("docx template fill: '{DOCX_MAIN}' not found — not a valid .docx"));
    }
    ooxml_repack(&parts)
}

/// Best-effort surgical edit of `word/document.xml` (`<w:t>` runs). Returns the
/// repacked bytes on success, or an actionable error with NO file change.
pub fn docx_surgical_edit(file_bytes: &[u8], find: &str, replace: &str) -> Result<Vec<u8>, String> {
    let mut parts = ooxml_unpack(file_bytes)?;
    let mut edited = false;
    for (name, data_bytes) in parts.iter_mut() {
        if name == DOCX_MAIN {
            let xml = String::from_utf8(std::mem::take(data_bytes))
                .map_err(|e| format!("{DOCX_MAIN} utf8: {e}"))?;
            // local-name 't' covers <w:t>.
            let new_xml = surgical_replace_runs(&xml, find, replace, b"t")?;
            *data_bytes = new_xml.into_bytes();
            edited = true;
        }
    }
    if !edited {
        return Err(format!("docx surgical edit: '{DOCX_MAIN}' not found — not a valid .docx"));
    }
    ooxml_repack(&parts)
}

/// Best-effort surgical text replacement across every `ppt/slides/slideN.xml`
/// (`<a:t>` runs). The edit must match in EXACTLY one slide; matching in none or
/// in several is an error and leaves the file unchanged. All slides remain
/// present in the output regardless.
pub fn pptx_replace_text(file_bytes: &[u8], find: &str, replace: &str) -> Result<Vec<u8>, String> {
    let mut parts = ooxml_unpack(file_bytes)?;
    // Edit each slide independently; collect how many slides actually changed so
    // we can give a meaningful ambiguity / not-found error overall.
    let mut slides_changed = 0usize;
    let mut last_err: Option<String> = None;
    for (name, data_bytes) in parts.iter_mut() {
        if is_pptx_slide(name) {
            let xml = match String::from_utf8(data_bytes.clone()) {
                Ok(s) => s,
                Err(e) => return Err(format!("{name} utf8: {e}")),
            };
            match surgical_replace_runs(&xml, find, replace, b"t") {
                Ok(new_xml) => {
                    *data_bytes = new_xml.into_bytes();
                    slides_changed += 1;
                }
                Err(e) => {
                    // Remember an error but keep scanning other slides; a
                    // "not found in this slide" is normal when the text lives
                    // elsewhere.
                    last_err = Some(e);
                }
            }
        }
    }
    match slides_changed {
        0 => Err(last_err.unwrap_or_else(|| {
            format!("pptx replace: '{find}' not found in any slide. No change made.")
        })),
        1 => ooxml_repack(&parts),
        n => Err(format!(
            "pptx replace: '{find}' matched in {n} slides — provide a more specific 'find'. No change made."
        )),
    }
}

/// True for `ppt/slides/slideN.xml` parts (not the slide layouts/masters/rels).
fn is_pptx_slide(name: &str) -> bool {
    name.starts_with("ppt/slides/slide")
        && name.ends_with(".xml")
        // Exclude ppt/slides/_rels/... by rejecting any nested path segment.
        && !name["ppt/slides/".len()..].contains('/')
}

// ─── Tauri command ───────────────────────────────────────────────────────────

/// Result of a `document_edit` invocation surfaced to the frontend.
#[derive(Serialize)]
pub struct EditResult {
    /// Best-effort re-extracted plain text of the edited primary part, so the
    /// caller can show a preview without re-reading the file.
    pub preview_text: String,
    /// Whether the file on disk was modified.
    pub changed: bool,
}

/// Detect the OOXML family from a file path's extension.
fn ooxml_format(path: &str) -> Option<&'static str> {
    let lower = path.to_lowercase();
    if lower.ends_with(".docx") {
        Some("docx")
    } else if lower.ends_with(".xlsx") {
        Some("xlsx")
    } else if lower.ends_with(".pptx") {
        Some("pptx")
    } else {
        None
    }
}

/// Extract the visible text of the edited primary part for the preview. Mirrors
/// the host's text-extraction conventions (`<w:t>`/`<a:t>` local name `t`).
fn preview_for(parts: &[(String, Vec<u8>)], format: &str) -> String {
    let target_pred: Box<dyn Fn(&str) -> bool> = match format {
        "docx" => Box::new(|n: &str| n == DOCX_MAIN),
        "pptx" => Box::new(is_pptx_slide),
        // xlsx editing flows through shared strings; preview that.
        _ => Box::new(|n: &str| n == "xl/sharedStrings.xml"),
    };
    let mut out = String::new();
    for (name, data) in parts {
        if target_pred(name) {
            out.push_str(&extract_run_text(data));
            out.push('\n');
        }
    }
    out.trim_end().to_string()
}

/// Collect the concatenated text of every run-text (`<w:t>`/`<a:t>`, local name
/// `t`) element in an XML part — a lightweight preview extractor.
fn extract_run_text(xml_bytes: &[u8]) -> String {
    let mut reader = Reader::from_reader(xml_bytes);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut out = String::new();
    let mut in_t = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) if e.local_name().as_ref() == b"t" => in_t = true,
            Ok(Event::End(ref e)) if e.local_name().as_ref() == b"t" => in_t = false,
            Ok(Event::Text(ref e)) if in_t => {
                if let Ok(t) = e.unescape() {
                    out.push_str(&t);
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

// NOTE: The `#[tauri::command]` attribute and registration in `generate_handler!`
// are applied via the orchestrator's shared edits (lib.rs cannot be edited here).
// The function body below is complete and self-contained; it depends only on
// `crate::resolve_workspace_path`, which already exists in lib.rs.
//
// `op` is either:
//   { "template": true, "data": { "key": "value", ... } }   — PRIMARY fill
//   { "find": "...", "replace": "..." }                       — surgical edit
#[tauri::command]
pub async fn document_edit(path: String, op: serde_json::Value) -> Result<EditResult, String> {
    let abs = crate::resolve_workspace_path(&path)?;
    let abs_str = abs.to_str().ok_or("Invalid path")?.to_string();
    let format = ooxml_format(&abs_str)
        .ok_or_else(|| format!("document_edit: unsupported format for '{path}' (expected .docx/.xlsx/.pptx)"))?;

    tauri::async_runtime::spawn_blocking(move || {
        let file_bytes = std::fs::read(&abs_str).map_err(|e| format!("read {abs_str}: {e}"))?;

        // Route on the op shape.
        let is_template = op.get("template").and_then(|v| v.as_bool()).unwrap_or(false);

        let new_bytes: Vec<u8> = if is_template {
            let data_obj = op
                .get("data")
                .and_then(|v| v.as_object())
                .ok_or("document_edit: template op requires a 'data' object")?;
            let data: HashMap<String, String> = data_obj
                .iter()
                .map(|(k, v)| {
                    let val = match v {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    (k.clone(), val)
                })
                .collect();
            match format {
                "docx" => docx_template_fill(&file_bytes, &data)?,
                // xlsx/pptx template fill targets the main editable part. For
                // pptx the placeholders live across slides; fill them all.
                "pptx" => pptx_template_fill(&file_bytes, &data)?,
                "xlsx" => xlsx_template_fill(&file_bytes, &data)?,
                _ => unreachable!(),
            }
        } else {
            let find = op
                .get("find")
                .and_then(|v| v.as_str())
                .ok_or("document_edit: edit op requires a 'find' string")?;
            let replace = op.get("replace").and_then(|v| v.as_str()).unwrap_or("");
            match format {
                "docx" => docx_surgical_edit(&file_bytes, find, replace)?,
                "pptx" => pptx_replace_text(&file_bytes, find, replace)?,
                "xlsx" => xlsx_replace_text(&file_bytes, find, replace)?,
                _ => unreachable!(),
            }
        };

        // Re-extract a preview from the freshly edited parts.
        let new_parts = ooxml_unpack(&new_bytes)?;
        let preview_text = preview_for(&new_parts, format);

        std::fs::write(&abs_str, &new_bytes).map_err(|e| format!("write {abs_str}: {e}"))?;

        Ok(EditResult {
            preview_text,
            changed: true,
        })
    })
    .await
    .map_err(|e| format!("document_edit task: {e}"))?
}

// ─── pptx / xlsx template + surgical helpers ─────────────────────────────────

/// Template-fill every slide's XML (`ppt/slides/slideN.xml`). Placeholders that
/// don't appear in a given slide are left alone, so unrelated slides are
/// untouched and ALL slides remain present.
pub fn pptx_template_fill(file_bytes: &[u8], data: &HashMap<String, String>) -> Result<Vec<u8>, String> {
    let mut parts = ooxml_unpack(file_bytes)?;
    for (name, data_bytes) in parts.iter_mut() {
        if is_pptx_slide(name) {
            let xml = String::from_utf8(std::mem::take(data_bytes))
                .map_err(|e| format!("{name} utf8: {e}"))?;
            *data_bytes = template_fill(&xml, data).into_bytes();
        }
    }
    ooxml_repack(&parts)
}

/// Template-fill the workbook's shared-strings table (`xl/sharedStrings.xml`),
/// where Excel stores cell text. Numeric/inline cells are not touched.
pub fn xlsx_template_fill(file_bytes: &[u8], data: &HashMap<String, String>) -> Result<Vec<u8>, String> {
    let mut parts = ooxml_unpack(file_bytes)?;
    let mut found = false;
    for (name, data_bytes) in parts.iter_mut() {
        if name == "xl/sharedStrings.xml" {
            let xml = String::from_utf8(std::mem::take(data_bytes))
                .map_err(|e| format!("{name} utf8: {e}"))?;
            *data_bytes = template_fill(&xml, data).into_bytes();
            found = true;
        }
    }
    if !found {
        return Err(
            "xlsx template fill: 'xl/sharedStrings.xml' not found — workbook has no shared-string cells to fill"
                .to_string(),
        );
    }
    ooxml_repack(&parts)
}

/// Best-effort surgical text replacement in the workbook's shared strings
/// (`<t>` runs). Excel shares identical strings, so a value may legitimately
/// appear once in the table even if shown in many cells.
pub fn xlsx_replace_text(file_bytes: &[u8], find: &str, replace: &str) -> Result<Vec<u8>, String> {
    let mut parts = ooxml_unpack(file_bytes)?;
    let mut edited = false;
    for (name, data_bytes) in parts.iter_mut() {
        if name == "xl/sharedStrings.xml" {
            let xml = String::from_utf8(std::mem::take(data_bytes))
                .map_err(|e| format!("{name} utf8: {e}"))?;
            let new_xml = surgical_replace_runs(&xml, find, replace, b"t")?;
            *data_bytes = new_xml.into_bytes();
            edited = true;
        }
    }
    if !edited {
        return Err(
            "xlsx replace: 'xl/sharedStrings.xml' not found — workbook has no shared-string cells to edit"
                .to_string(),
        );
    }
    ooxml_repack(&parts)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal but structurally valid `.docx` in memory. The
    /// `document.xml` is supplied so individual tests can vary the body markup
    /// (e.g. clean run vs. fragmented run).
    fn build_docx(document_xml: &str) -> Vec<u8> {
        let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#;
        let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;
        let parts: Vec<(String, Vec<u8>)> = vec![
            ("[Content_Types].xml".to_string(), content_types.as_bytes().to_vec()),
            ("_rels/.rels".to_string(), rels.as_bytes().to_vec()),
            ("word/document.xml".to_string(), document_xml.as_bytes().to_vec()),
        ];
        ooxml_repack(&parts).expect("repack test docx")
    }

    /// A plain Word body wrapper.
    fn doc_body(inner: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{inner}</w:body></w:document>"#
        )
    }

    #[test]
    fn unpack_repack_is_lossless() {
        let doc = doc_body(r#"<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>"#);
        let bytes = build_docx(&doc);
        let parts1 = ooxml_unpack(&bytes).expect("unpack 1");
        let repacked = ooxml_repack(&parts1).expect("repack");
        let parts2 = ooxml_unpack(&repacked).expect("unpack 2");
        // Assert on the PARTS vector (names + content bytes), not raw zip bytes.
        assert_eq!(parts1, parts2, "unpack->repack->unpack must be byte-identical per part");
        // And the original three parts survive in order.
        assert_eq!(parts1.len(), 3);
        assert_eq!(parts1[0].0, "[Content_Types].xml");
        assert_eq!(parts1[2].0, "word/document.xml");
    }

    #[test]
    fn template_fill_replaces_and_escapes() {
        let xml = r#"<w:t>Dear {{name}}, balance {{amount}}</w:t>"#;
        let mut data = HashMap::new();
        data.insert("name".to_string(), "Tom & Jerry <jr>".to_string());
        data.insert("amount".to_string(), "5".to_string());
        let out = template_fill(xml, &data);
        assert!(out.contains("Dear Tom &amp; Jerry &lt;jr&gt;, balance 5"));
        // No leftover placeholders.
        assert!(!out.contains("{{"));
    }

    #[test]
    fn template_fill_leaves_unknown_keys() {
        let xml = r#"<w:t>{{known}} and {{unknown}}</w:t>"#;
        let mut data = HashMap::new();
        data.insert("known".to_string(), "X".to_string());
        let out = template_fill(xml, &data);
        assert!(out.contains("X and {{unknown}}"));
    }

    #[test]
    fn docx_template_fill_only_touches_document_part() {
        let doc = doc_body(r#"<w:p><w:r><w:t>Hi {{name}}</w:t></w:r></w:p>"#);
        let bytes = build_docx(&doc);
        let mut data = HashMap::new();
        data.insert("name".to_string(), "Ada".to_string());
        let out = docx_template_fill(&bytes, &data).expect("fill");
        let parts = ooxml_unpack(&out).expect("unpack");
        // Other parts identical to the originals.
        let orig = ooxml_unpack(&bytes).expect("orig unpack");
        for (op, np) in orig.iter().zip(parts.iter()) {
            if op.0 != "word/document.xml" {
                assert_eq!(op, np, "non-document part {} must be untouched", op.0);
            }
        }
        // Document part filled.
        let doc_part = parts.iter().find(|(n, _)| n == "word/document.xml").unwrap();
        let s = String::from_utf8(doc_part.1.clone()).unwrap();
        assert!(s.contains("Hi Ada"));
        assert!(!s.contains("{{name}}"));
    }

    #[test]
    fn surgical_clean_unique_match() {
        // "Hello world" lives in one run; a unique find should rewrite cleanly.
        let xml = r#"<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>"#;
        let out = surgical_replace_runs(xml, "world", "there", b"t").expect("ok");
        assert!(out.contains("Hello there"));
        assert!(!out.contains("world"));
    }

    #[test]
    fn surgical_match_across_run_boundary() {
        // "Hello" is fragmented across two runs ("Hel" + "lo"). Coalescing must
        // recover it; the replacement goes into the first run, the rest blanked.
        let xml = r#"<w:p><w:r><w:t>Hel</w:t></w:r><w:r><w:t>lo world</w:t></w:r></w:p>"#;
        let out = surgical_replace_runs(xml, "Hello", "Hi", b"t").expect("ok across runs");
        // Re-extract the visible text — should read "Hi world".
        let visible = extract_run_text(out.as_bytes());
        assert_eq!(visible, "Hi world");
    }

    #[test]
    fn surgical_absent_match_errors_no_change() {
        let xml = r#"<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>"#;
        let err = surgical_replace_runs(xml, "zzz", "x", b"t").unwrap_err();
        assert!(err.contains("not found"), "got: {err}");
    }

    #[test]
    fn surgical_ambiguous_match_errors_no_change() {
        // "ab" twice in coalesced text -> ambiguous.
        let xml = r#"<w:p><w:r><w:t>ab cd ab</w:t></w:r></w:p>"#;
        let err = surgical_replace_runs(xml, "ab", "x", b"t").unwrap_err();
        assert!(err.contains("ambiguous"), "got: {err}");
    }

    #[test]
    fn pptx_replace_keeps_all_slides() {
        // Build a 2-slide pptx; only slide1 has the target text.
        let slide1 = r#"<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Quarterly Report</a:t></p:sld>"#;
        let slide2 = r#"<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Appendix</a:t></p:sld>"#;
        let parts: Vec<(String, Vec<u8>)> = vec![
            ("[Content_Types].xml".to_string(), b"<Types/>".to_vec()),
            ("ppt/slides/slide1.xml".to_string(), slide1.as_bytes().to_vec()),
            ("ppt/slides/slide2.xml".to_string(), slide2.as_bytes().to_vec()),
        ];
        let bytes = ooxml_repack(&parts).expect("pack");
        let out = pptx_replace_text(&bytes, "Quarterly Report", "Annual Report").expect("replace");
        let out_parts = ooxml_unpack(&out).expect("unpack");
        // Both slides still present.
        assert!(out_parts.iter().any(|(n, _)| n == "ppt/slides/slide1.xml"));
        assert!(out_parts.iter().any(|(n, _)| n == "ppt/slides/slide2.xml"));
        // Slide 1 edited; slide 2 untouched.
        let s1 = out_parts.iter().find(|(n, _)| n == "ppt/slides/slide1.xml").unwrap();
        let s2 = out_parts.iter().find(|(n, _)| n == "ppt/slides/slide2.xml").unwrap();
        assert!(String::from_utf8(s1.1.clone()).unwrap().contains("Annual Report"));
        assert!(String::from_utf8(s2.1.clone()).unwrap().contains("Appendix"));
    }

    #[test]
    fn pptx_absent_text_errors() {
        let slide1 = r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Hello</a:t></p:sld>"#;
        let parts: Vec<(String, Vec<u8>)> = vec![
            ("ppt/slides/slide1.xml".to_string(), slide1.as_bytes().to_vec()),
        ];
        let bytes = ooxml_repack(&parts).expect("pack");
        let err = pptx_replace_text(&bytes, "Nope", "x").unwrap_err();
        assert!(err.contains("not found"), "got: {err}");
    }

    #[test]
    fn is_pptx_slide_excludes_rels_and_layouts() {
        assert!(is_pptx_slide("ppt/slides/slide1.xml"));
        assert!(is_pptx_slide("ppt/slides/slide12.xml"));
        assert!(!is_pptx_slide("ppt/slides/_rels/slide1.xml.rels"));
        assert!(!is_pptx_slide("ppt/slideLayouts/slideLayout1.xml"));
        assert!(!is_pptx_slide("ppt/slideMasters/slideMaster1.xml"));
    }
}
