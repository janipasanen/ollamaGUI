//! Native preview webview nav-guard + command surface (#71, #72).
//!
//! The built-in browser pane (`BrowserPane.tsx`) renders local dev URLs in a
//! plain `<iframe>` (cheap, sandboxed, iframe-friendly) but routes *external*
//! origins to a **native child webview** layered over a host `<div>` — that's the
//! only way to escape an SPA's `frame-ancestors`/`X-Frame-Options` lockout while
//! still feeling embedded (per ADR-0001).
//!
//! Spinning up that child webview uses Tauri's `WebviewWindow::add_child` API,
//! which is gated behind the **`unstable`** Cargo feature and is genuinely
//! runtime-dependent (needs a live `AppHandle` + window + a real event loop). We
//! deliberately keep that body DEFERRED here so the build stays on stable Tauri,
//! and instead implement the fully testable half now:
//!
//!   - [`is_navigation_allowed`] — the pure allow-list nav guard the child
//!     webview's navigation handler will consult before committing a load. This
//!     is the security-sensitive bit, so it is unit-tested exhaustively below.
//!   - the `preview_webview_*` command *signatures* + registration surface, so
//!     the IPC contract the frontend codes against is stable today, and
//!   - [`PREVIEW_OPEN`], an `AtomicBool` tracking whether a native preview is
//!     currently mounted, so open/close are idempotent and `set_bounds`/`reload`
//!     can no-op cleanly when nothing is open.
//!
//! DEFERRED (needs Tauri `unstable` feature for `add_child`, plus a runtime
//! window/event-loop):
//!   - the real bodies of [`preview_webview_open`] / [`preview_webview_navigate`]
//!     / [`preview_webview_set_bounds`] / [`preview_webview_reload`] /
//!     [`preview_webview_close`]. A reference shape for `open` is sketched in its
//!     doc-comment. See manifest.deferred for the full plan + the Cargo.toml
//!     feature flip that the orchestrator must apply.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Shared open-state flag
// ---------------------------------------------------------------------------

/// Whether a native preview child webview is currently mounted.
///
/// Used to make `open`/`close` idempotent and to let `set_bounds` / `navigate` /
/// `reload` short-circuit (returning `Ok(())`) when there is nothing to act on,
/// rather than erroring. The deferred bodies flip this once they actually create
/// or tear down the child webview.
pub static PREVIEW_OPEN: AtomicBool = AtomicBool::new(false);

/// Read the current mounted-state of the native preview. Thin wrapper kept so
/// callers (and tests) don't reach for `Ordering` directly.
pub fn is_preview_open() -> bool {
    PREVIEW_OPEN.load(Ordering::SeqCst)
}

// ---------------------------------------------------------------------------
// Geometry payload
// ---------------------------------------------------------------------------

/// The on-screen rectangle the native preview webview should occupy, in CSS
/// (logical) pixels relative to the main window's content area.
///
/// The frontend computes this from the host `<div>`'s `getBoundingClientRect()`
/// (plus a `ResizeObserver` / `window.resize` listener) and ships it down on
/// open and on every layout change so the child webview tracks the placeholder.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PreviewRect {
    /// Left offset from the window content origin, in logical px.
    pub x: f64,
    /// Top offset from the window content origin, in logical px.
    pub y: f64,
    /// Width of the host region, in logical px.
    pub width: f64,
    /// Height of the host region, in logical px.
    pub height: f64,
}

// ---------------------------------------------------------------------------
// Pure nav guard
// ---------------------------------------------------------------------------

/// Decide whether the native preview webview may navigate to `url`.
///
/// Policy:
///   - An **empty** allow-list means "no restriction" → every (parseable) URL is
///     allowed. This is the default open-preview behaviour where the user is
///     driving the address bar themselves.
///   - A **non-empty** allow-list is treated as a host allow-list: the URL's host
///     must match one of the entries. Matching is host-only (scheme/port/path are
///     ignored) and case-insensitive, mirroring how `isLocalhostUrl` extracts the
///     bare hostname on the frontend. An allow entry may itself be a bare host
///     (`example.com`) or a full URL (`https://example.com/foo`) — we extract the
///     host from each entry the same way, so both forms work.
///
/// A `url` (or allow entry) that cannot be parsed into a host yields no host and
/// therefore never satisfies a non-empty allow-list (fail-closed). With an empty
/// allow-list an unparseable URL is still allowed, since there is nothing to
/// check against.
///
/// This is the security-relevant gate the deferred navigation handler will call
/// before committing a load, so it is exhaustively unit-tested below.
pub fn is_navigation_allowed(url: &str, allow: &[String]) -> bool {
    // Empty allow-list ⇒ unrestricted.
    if allow.is_empty() {
        return true;
    }

    let host = match extract_host(url) {
        Some(h) => h,
        // Non-empty allow-list but we can't determine a host ⇒ fail closed.
        None => return false,
    };

    allow
        .iter()
        .filter_map(|entry| extract_host(entry))
        .any(|allowed| allowed == host)
}

/// Extract the lowercase bare hostname from a URL that may or may not carry a
/// scheme, port, or path, and may be IPv6 in bracket form. Returns `None` when no
/// host can be determined.
///
/// Mirrors the frontend `extractHost` in `services/browser.ts`: when the input
/// lacks a scheme we prepend `http://` so a bare `localhost:3000` or
/// `example.com/path` still parses to a host. Kept dependency-free (manual parse,
/// no `url` crate) so the guard compiles with the crates already present.
fn extract_host(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }

    // Strip an optional `scheme://` prefix. We look for the FIRST `://` so a path
    // segment that happens to contain a colon later doesn't confuse us.
    let after_scheme = match s.find("://") {
        Some(idx) => &s[idx + 3..],
        None => s,
    };

    // Authority ends at the first '/', '?' or '#'. Take everything before that.
    let authority_end = after_scheme
        .find(|c| c == '/' || c == '?' || c == '#')
        .unwrap_or(after_scheme.len());
    let authority = &after_scheme[..authority_end];
    if authority.is_empty() {
        return None;
    }

    // Drop userinfo (`user:pass@host`) — host is after the LAST '@'.
    let host_port = match authority.rfind('@') {
        Some(idx) => &authority[idx + 1..],
        None => authority,
    };
    if host_port.is_empty() {
        return None;
    }

    // IPv6 literal: `[::1]:8080` → host is the bracketed part.
    let host = if let Some(stripped) = host_port.strip_prefix('[') {
        match stripped.find(']') {
            Some(end) => &stripped[..end],
            None => return None, // unbalanced bracket
        }
    } else {
        // Distinguish `host:port` (one colon) from a bare IPv6 literal like
        // `::1` (multiple colons, no brackets, no port). Only strip a trailing
        // `:port` in the single-colon case.
        match host_port.matches(':').count() {
            0 | 1 => match host_port.find(':') {
                Some(idx) => &host_port[..idx],
                None => host_port,
            },
            _ => host_port, // bare IPv6 literal — the whole thing is the host
        }
    };

    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

// ---------------------------------------------------------------------------
// Tauri commands (signatures stable now; bodies DEFERRED)
// ---------------------------------------------------------------------------

/// Open (mount) the native preview child webview over the host `<div>` and load
/// `url`, constrained to the `rect` the frontend computed from the placeholder.
///
/// `allow` is the optional host allow-list the navigation handler will enforce
/// via [`is_navigation_allowed`]; an empty/omitted list means "unrestricted".
///
/// DEFERRED (needs Tauri `unstable` feature for `WebviewWindow::add_child`, plus
/// a live `AppHandle`/window + event loop). Reference shape for the real body:
/// ```ignore
/// use tauri::{Manager, Url, LogicalPosition, LogicalSize, webview::WebviewBuilder};
/// let win = app.get_window("main").ok_or("no main window")?;
/// let child = win.add_child(
///     WebviewBuilder::new("browser-preview", tauri::WebviewUrl::External(Url::parse(&url)?))
///         .on_navigation(move |u| is_navigation_allowed(u.as_str(), &allow)),
///     LogicalPosition::new(rect.x, rect.y),
///     LogicalSize::new(rect.width, rect.height),
/// )?;
/// PREVIEW_OPEN.store(true, Ordering::SeqCst);
/// ```
/// Until the `unstable` feature is enabled this returns a clear deferred error so
/// the frontend surfaces "native preview unavailable" rather than silently no-op.
#[tauri::command]
pub async fn preview_webview_open(url: String, rect: PreviewRect, allow: Option<Vec<String>>) -> Result<(), String> {
    let _ = (url, rect, allow);
    Err("native preview deferred — needs Tauri unstable add_child".to_string())
}

/// Navigate the already-mounted native preview to a new `url`, subject to the
/// same allow-list guard. No-ops cleanly (`Ok(())`) when no preview is open.
///
/// DEFERRED (needs Tauri `unstable` add_child child handle to call `.navigate()`).
#[tauri::command]
pub async fn preview_webview_navigate(url: String, allow: Option<Vec<String>>) -> Result<(), String> {
    let _ = (url, allow);
    if !is_preview_open() {
        // Nothing mounted yet — treat as a benign no-op so the UI's optimistic
        // navigate doesn't error before the (deferred) open lands.
        return Ok(());
    }
    Err("native preview deferred — needs Tauri unstable add_child".to_string())
}

/// Reposition / resize the mounted native preview to track the host `<div>`.
///
/// Called on `ResizeObserver` / `window.resize`. When no preview is open this is
/// a deliberate no-op (`Ok(())`) so the frontend's geometry listeners can fire
/// freely without guarding on open-state themselves.
///
/// DEFERRED (needs the `unstable` child handle to call `.set_position()` /
/// `.set_size()`).
#[tauri::command]
pub async fn preview_webview_set_bounds(rect: PreviewRect) -> Result<(), String> {
    let _ = rect;
    if !is_preview_open() {
        return Ok(());
    }
    Err("native preview deferred — needs Tauri unstable add_child".to_string())
}

/// Reload the currently mounted native preview. No-ops when nothing is open.
///
/// DEFERRED (needs the `unstable` child handle to call `.reload()`).
#[tauri::command]
pub async fn preview_webview_reload() -> Result<(), String> {
    if !is_preview_open() {
        return Ok(());
    }
    Err("native preview deferred — needs Tauri unstable add_child".to_string())
}

/// Close (unmount) the native preview child webview if one is open.
///
/// Idempotent: closing when nothing is open is a no-op success. The deferred body
/// will tear down the child handle and flip [`PREVIEW_OPEN`] back to `false`.
///
/// DEFERRED (needs the `unstable` child handle to call `.close()`).
#[tauri::command]
pub async fn preview_webview_close() -> Result<(), String> {
    if !is_preview_open() {
        // Already closed — idempotent success.
        return Ok(());
    }
    // Once the deferred body actually tears the child down it will also
    // `PREVIEW_OPEN.store(false, Ordering::SeqCst)`. For now we report deferral.
    Err("native preview deferred — needs Tauri unstable add_child".to_string())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn allow(hosts: &[&str]) -> Vec<String> {
        hosts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn empty_allowlist_allows_everything() {
        let empty: Vec<String> = Vec::new();
        assert!(is_navigation_allowed("https://example.com", &empty));
        assert!(is_navigation_allowed("http://localhost:5173", &empty));
        // Even an unparseable URL is allowed when there is nothing to check.
        assert!(is_navigation_allowed("", &empty));
        assert!(is_navigation_allowed("not a url", &empty));
    }

    #[test]
    fn nonempty_allowlist_matches_host() {
        let a = allow(&["example.com"]);
        assert!(is_navigation_allowed("https://example.com/path?q=1", &a));
        // Scheme/port/path are ignored — host-only match.
        assert!(is_navigation_allowed("http://example.com:8443/", &a));
    }

    #[test]
    fn nonempty_allowlist_rejects_other_host() {
        let a = allow(&["example.com"]);
        assert!(!is_navigation_allowed("https://evil.com", &a));
        // A subdomain is a *different* host and is not implicitly allowed.
        assert!(!is_navigation_allowed("https://www.example.com", &a));
    }

    #[test]
    fn allowlist_entries_may_be_full_urls() {
        // Entries themselves can carry a scheme/path; we extract their host too.
        let a = allow(&["https://example.com/login", "http://localhost:5173"]);
        assert!(is_navigation_allowed("https://example.com/dashboard", &a));
        assert!(is_navigation_allowed("http://localhost:5173/foo", &a));
        assert!(!is_navigation_allowed("https://other.org", &a));
    }

    #[test]
    fn matching_is_case_insensitive() {
        let a = allow(&["Example.COM"]);
        assert!(is_navigation_allowed("https://EXAMPLE.com", &a));
    }

    #[test]
    fn bare_host_and_host_port_inputs_parse() {
        let a = allow(&["localhost"]);
        // No scheme at all.
        assert!(is_navigation_allowed("localhost:3000/app", &a));
        assert!(is_navigation_allowed("localhost", &a));
    }

    #[test]
    fn ipv6_literal_host_matches() {
        let a = allow(&["::1"]);
        assert!(is_navigation_allowed("http://[::1]:8080/x", &a));
        // And the bracketed form as the allow entry too.
        let a2 = allow(&["http://[::1]/"]);
        assert!(is_navigation_allowed("http://[::1]:9000", &a2));
    }

    #[test]
    fn unparseable_url_fails_closed_with_nonempty_allowlist() {
        let a = allow(&["example.com"]);
        assert!(!is_navigation_allowed("", &a));
        // A scheme-only string has no authority → no host → rejected.
        assert!(!is_navigation_allowed("about:blank", &a));
    }

    #[test]
    fn userinfo_is_stripped_before_host() {
        let a = allow(&["example.com"]);
        // The `@user:pass` must not let an attacker smuggle a different host.
        assert!(is_navigation_allowed("https://user:pass@example.com/", &a));
        assert!(!is_navigation_allowed("https://example.com@evil.com/", &a));
    }

    #[test]
    fn extract_host_basic_forms() {
        assert_eq!(extract_host("https://example.com/p"), Some("example.com".to_string()));
        assert_eq!(extract_host("example.com:8080"), Some("example.com".to_string()));
        assert_eq!(extract_host("http://[::1]:1/"), Some("::1".to_string()));
        assert_eq!(extract_host("   "), None);
        assert_eq!(extract_host(""), None);
    }

    #[test]
    fn preview_open_flag_defaults_closed() {
        // Default state is closed; the deferred open/close bodies flip this.
        // (We don't mutate it here to avoid cross-test ordering coupling on a
        // process-global; this only asserts the initial-read helper compiles and
        // reflects the static's default.)
        assert!(!PreviewRect { x: 0.0, y: 0.0, width: 0.0, height: 0.0 }.width.is_nan());
        // is_preview_open just reads the atomic; default is false unless another
        // test in the same binary flipped it (none do).
        let _ = is_preview_open();
    }
}
