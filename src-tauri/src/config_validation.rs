//! Configuration validation helpers (ISSUE #66).
//!
//! This module provides small, dependency-free helpers that parse the two
//! security-relevant configuration files shipped with the desktop app:
//!
//!   * `capabilities/default.json` — the Tauri v2 capability manifest that
//!     gates which IPC commands the webview is allowed to invoke.
//!   * `tauri.conf.json` — the app config whose `app.security.csp` field
//!     defines the Content-Security-Policy served to the webview.
//!
//! The accompanying `#[cfg(test)] mod tests` asserts the *target* invariants
//! for #66: the webview/window capability identifiers are present, and the
//! CSP `connect-src` directive explicitly whitelists BOTH the local Ollama
//! endpoint (`http://localhost:11434`) and the Ollama Cloud endpoint
//! (`https://cloud.ollama.ai`).
//!
//! NOTE: These tests describe the TARGET state. The webview permission strings
//! and the hardened CSP are delivered as shared-file edits applied by the
//! orchestrator (see this issue's `sharedEdits`). The capability/CSP assertions
//! therefore pass only AFTER those edits land in `capabilities/default.json`
//! and `tauri.conf.json`. The pure parsing/helper logic is testable today.

use serde_json::Value;
use std::fs;
use std::path::PathBuf;

/// Absolute path to a file located relative to the crate root
/// (`src-tauri/`). Resolved at compile time via `CARGO_MANIFEST_DIR` so the
/// tests are independent of the process working directory.
fn manifest_relative(parts: &[&str]) -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for part in parts {
        path.push(part);
    }
    path
}

/// Read and parse `src-tauri/capabilities/default.json` into a JSON value.
///
/// Returns an `Err(String)` describing the failure if the file is missing or
/// is not valid JSON, so callers/tests get an actionable message.
pub fn load_capabilities() -> Result<Value, String> {
    let path = manifest_relative(&["capabilities", "default.json"]);
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("failed to parse {}: {}", path.display(), e))
}

/// Read and parse `src-tauri/tauri.conf.json` into a JSON value.
pub fn load_tauri_conf() -> Result<Value, String> {
    let path = manifest_relative(&["tauri.conf.json"]);
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("failed to parse {}: {}", path.display(), e))
}

/// Collect the `permissions` array of a capability manifest as owned strings.
///
/// Tauri capability entries may be either bare permission identifiers
/// (`"core:webview:allow-create-webview"`) or objects of the form
/// `{ "identifier": "...", "allow": [...] }`. Both shapes are normalised to
/// their identifier string here so membership checks are uniform.
pub fn capability_permission_identifiers(capabilities: &Value) -> Vec<String> {
    capabilities
        .get("permissions")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| match entry {
                    Value::String(s) => Some(s.clone()),
                    Value::Object(map) => map
                        .get("identifier")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Extract `app.security.csp` from a parsed `tauri.conf.json`, if present and
/// a non-empty string. Tauri also accepts an object-form CSP (per-directive
/// map); for #66 we require the simple string form, so the object form is
/// treated as "absent" here and reported by the caller.
pub fn csp_string(tauri_conf: &Value) -> Option<String> {
    tauri_conf
        .get("app")
        .and_then(|app| app.get("security"))
        .and_then(|security| security.get("csp"))
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
}

/// Pull out the body of the `connect-src` directive from a CSP string.
///
/// Returns the text between `connect-src` and the next `;` (or end of string),
/// trimmed, or `None` if the directive is absent. Matching is
/// case-insensitive on the directive name per the CSP grammar.
pub fn connect_src_directive(csp: &str) -> Option<String> {
    let lower = csp.to_ascii_lowercase();
    let start = lower.find("connect-src")?;
    // Slice the original (non-lowercased) string from just after the directive
    // name so source values keep their original casing (hosts are
    // case-insensitive but tokens read more clearly preserved).
    let after = &csp[start + "connect-src".len()..];
    let body = match after.find(';') {
        Some(idx) => &after[..idx],
        None => after,
    };
    Some(body.trim().to_string())
}

/// True if `csp`'s `connect-src` directive lists `source` as a whole token.
///
/// A naive `contains` check would let `http://localhost:11434` be satisfied by
/// a broader entry like `http://localhost:*`. We require an exact,
/// whitespace-delimited token match so #66's "explicitly includes BOTH
/// endpoints" requirement is genuinely enforced.
pub fn connect_src_has_source(csp: &str, source: &str) -> bool {
    match connect_src_directive(csp) {
        Some(directive) => directive
            .split_whitespace()
            .any(|token| token.eq_ignore_ascii_case(source)),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ----- Pure-logic tests (pass today, independent of shared edits) -------

    #[test]
    fn connect_src_directive_is_extracted() {
        let csp = "default-src 'self'; connect-src 'self' http://localhost:11434; img-src 'self'";
        assert_eq!(
            connect_src_directive(csp).as_deref(),
            Some("'self' http://localhost:11434")
        );
    }

    #[test]
    fn connect_src_directive_handles_trailing_directive() {
        // connect-src as the final directive (no trailing semicolon).
        let csp = "default-src 'self'; connect-src 'self' https://cloud.ollama.ai";
        assert_eq!(
            connect_src_directive(csp).as_deref(),
            Some("'self' https://cloud.ollama.ai")
        );
    }

    #[test]
    fn source_match_is_whole_token_not_substring() {
        // A wildcard entry must NOT satisfy an exact-host requirement.
        let csp = "connect-src 'self' http://localhost:*";
        assert!(!connect_src_has_source(csp, "http://localhost:11434"));
        // The exact host does satisfy it.
        let csp = "connect-src 'self' http://localhost:11434 http://localhost:*";
        assert!(connect_src_has_source(csp, "http://localhost:11434"));
    }

    #[test]
    fn capability_identifiers_normalise_string_and_object_forms() {
        let caps = serde_json::json!({
            "permissions": [
                "core:default",
                { "identifier": "fs:allow-read", "allow": [{ "path": "$APP" }] }
            ]
        });
        let ids = capability_permission_identifiers(&caps);
        assert!(ids.contains(&"core:default".to_string()));
        assert!(ids.contains(&"fs:allow-read".to_string()));
    }

    #[test]
    fn csp_string_rejects_empty_and_object_forms() {
        assert_eq!(csp_string(&serde_json::json!({})), None);
        let obj_form = serde_json::json!({
            "app": { "security": { "csp": { "default-src": ["'self'"] } } }
        });
        assert_eq!(csp_string(&obj_form), None);
        let ok = serde_json::json!({
            "app": { "security": { "csp": "default-src 'self'" } }
        });
        assert_eq!(csp_string(&ok).as_deref(), Some("default-src 'self'"));
    }

    // ----- File-backed invariant tests (TARGET state) -----------------------
    //
    // The following tests read the real config files from disk. They pass once
    // the orchestrator applies this issue's sharedEdits to
    // `capabilities/default.json` and `tauri.conf.json`. Until then the
    // capability/CSP assertions are expected to fail — that is intentional;
    // they encode the acceptance criteria for #66.

    #[test]
    fn config_files_parse() {
        load_capabilities().expect("capabilities/default.json must be valid JSON");
        load_tauri_conf().expect("tauri.conf.json must be valid JSON");
    }

    #[test]
    fn capabilities_contain_webview_and_window_permissions() {
        let caps = load_capabilities().expect("capabilities parse");
        let ids = capability_permission_identifiers(&caps);
        // Webview lifecycle/geometry permissions required for the #66 spike.
        for required in [
            "core:webview:allow-create-webview",
            "core:webview:allow-set-webview-position",
            "core:webview:allow-set-webview-size",
            "core:webview:allow-webview-close",
            "core:window:allow-inner-size",
        ] {
            assert!(
                ids.contains(&required.to_string()),
                "expected capability `{}` in capabilities/default.json (apply sharedEdits); found: {:?}",
                required,
                ids
            );
        }
    }

    #[test]
    fn csp_is_non_null_string() {
        let conf = load_tauri_conf().expect("tauri.conf parse");
        assert!(
            csp_string(&conf).is_some(),
            "app.security.csp must be a non-empty string"
        );
    }

    #[test]
    fn csp_connect_src_allows_both_ollama_endpoints() {
        let conf = load_tauri_conf().expect("tauri.conf parse");
        let csp = csp_string(&conf).expect("csp string present");
        assert!(
            connect_src_has_source(&csp, "http://localhost:11434"),
            "CSP connect-src must explicitly allow the local Ollama endpoint \
             http://localhost:11434 (apply sharedEdits); connect-src = {:?}",
            connect_src_directive(&csp)
        );
        assert!(
            connect_src_has_source(&csp, "https://cloud.ollama.ai"),
            "CSP connect-src must explicitly allow the Ollama Cloud endpoint \
             https://cloud.ollama.ai (apply sharedEdits); connect-src = {:?}",
            connect_src_directive(&csp)
        );
    }
}
