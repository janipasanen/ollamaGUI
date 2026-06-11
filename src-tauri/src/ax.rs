//! CDP automation engine — testable core (#73).
//!
//! The browser-automation engine drives a Chromium-class browser over the Chrome
//! DevTools Protocol (CDP) and turns each page into a compact, *agent-readable*
//! accessibility (AX) outline. That outline is what the model actually "sees":
//! a flat, indented list of interactive controls plus a little structural context
//! (headings/landmarks), each actionable control tagged with a stable `eNN` ref.
//! The model then acts by ref (`click e6`, `type e5 "alice@x.com"`), and the
//! engine maps that ref back to a CDP `backendDOMNodeId` to perform the action.
//!
//! This module implements the **fully unit-testable, dependency-free core** of
//! that engine now (serde_json + std only):
//!
//!   - [`serialize_ax_tree`] — walk a CDP AX tree into the indented outline +
//!     the `eNN -> backendDOMNodeId` resolution map. This is the spike-validated
//!     heart of the engine and is exhaustively tested below.
//!   - [`resolve_ref`]       — map an `eNN` ref back to its backend node id.
//!   - [`redact_secret_value`] — replace the visible name of a secret-flagged
//!     control with `***` so passwords/tokens never reach the model context.
//!   - [`strip_query_credentials`] — scrub credential-bearing query params
//!     (`token`, `access_token`, `code`, `api_key`, `password`) from any URL the
//!     engine is about to navigate to or log.
//!   - [`ConsoleRing`]       — a bounded ring buffer modelling the 10k-line
//!     console capture cap so a chatty page can't grow memory without bound.
//!
//! ## Input contract for [`serialize_ax_tree`]
//!
//! The serializer accepts **either** of two shapes (both are exercised by the
//! tests), so it works against the raw `Accessibility.getFullAXTree` CDP payload
//! *and* against a simplified nested form that is convenient for tests/tools:
//!
//! 1. **CDP flat form** (the real wire shape):
//!    ```json
//!    { "nodes": [
//!        { "nodeId": "1", "ignored": false,
//!          "role": { "value": "button" },
//!          "name": { "value": "Sign in" },
//!          "backendDOMNodeId": 42,
//!          "childIds": ["2", "3"] },
//!        ...
//!    ] }
//!    ```
//!    Nodes are addressed by `nodeId`; `childIds` give the tree edges. The first
//!    node (or any node not referenced as a child) is treated as a root.
//!
//! 2. **Simplified nested form** (handy for fixtures / higher-level callers):
//!    ```json
//!    { "role": "button", "name": "Sign in", "backendDOMNodeId": 42,
//!      "children": [ ... ] }
//!    ```
//!    Here `role`/`name` are bare strings and `children` is an inline array.
//!
//! In both shapes a node may carry an optional `"secret": true` flag (or, in the
//! flat form, a `properties` entry — see [`node_is_secret`]) marking a sensitive
//! input whose name must be redacted in the outline.
//!
//! ## DEFERRED — chromiumoxide CDP I/O (needs the `chromiumoxide` crate + runtime)
//!
//! The actual CDP transport lives behind the [`BrowserEngine`] trait below so the
//! command surface is stable and testable today, while the network/process side
//! is added later. The Tauri commands that the trait will back are:
//!
//!   - `browser_engine_start` / `browser_engine_stop`  — launch/teardown the
//!     headless (or headful) Chromium process and attach a CDP session.
//!   - `browser_cdp_navigate { url }`                  — navigate, stripping
//!     credentials via [`strip_query_credentials`] first.
//!   - `browser_cdp_get_ax_tree`                       — `Accessibility.getFullAXTree`
//!     then [`serialize_ax_tree`] -> `{ outline, refs }`.
//!   - `browser_cdp_click { ref }` / `browser_cdp_type { ref, text }` — resolve
//!     the ref via [`resolve_ref`], then `DOM.resolveNode` + input dispatch.
//!   - `browser_cdp_screenshot`                        — `Page.captureScreenshot`.
//!   - `browser_cdp_eval { expression }`               — `Runtime.evaluate`.
//!   - `browser_cdp_read_console`                      — drain the [`ConsoleRing`].
//!   - `browser_cdp_read_network`                      — drain captured requests
//!     (URLs scrubbed with [`strip_query_credentials`]).
//!
//! A `BROWSER_ENGINE` global (e.g. `lazy_static! { static ref BROWSER_ENGINE:
//! Mutex<Option<Box<dyn BrowserEngine>>> }`) will hold the live engine. The
//! concrete `ChromiumoxideEngine: BrowserEngine` impl and the command bodies are
//! the only parts that need the crate; everything in *this* module is the pure
//! core they build on. See `manifest.deferred` and the `sharedEdits` snippet.

use std::collections::HashMap;
use std::collections::VecDeque;

use serde_json::Value;

// ---------------------------------------------------------------------------
// Role classification
// ---------------------------------------------------------------------------

/// Roles that are **actionable** — i.e. the agent can click/type/toggle them, so
/// they get a stable `eNN` ref and become the addressable surface of the page.
///
/// Kept deliberately broad (form controls, links, buttons, menu items, tabs,
/// options) because anything the model might target needs a ref to act on it.
const ACTIONABLE_ROLES: &[&str] = &[
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "listbox",
    "option",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "tab",
    "switch",
    "slider",
    "searchbox",
    "spinbutton",
    "textarea",
];

/// Roles that are emitted for **context only** — headings and landmarks give the
/// model structural orientation ("we're under the 'Account' heading") but are not
/// actionable, so they appear in the outline *without* a ref.
const CONTEXT_ROLES: &[&str] = &[
    "heading",
    "navigation",
    "main",
    "banner",
    "contentinfo",
    "complementary",
    "region",
    "form",
    "search",
    "article",
    "dialog",
    "alert",
];

/// True for roles the agent can interact with (gets a ref).
fn is_actionable_role(role: &str) -> bool {
    ACTIONABLE_ROLES.contains(&role)
}

/// True for purely structural context roles (emitted without a ref).
fn is_context_role(role: &str) -> bool {
    CONTEXT_ROLES.contains(&role)
}

// ---------------------------------------------------------------------------
// Normalised view over either input shape
// ---------------------------------------------------------------------------

/// A node's salient fields, normalised across the flat-CDP and nested input
/// shapes so the walker can treat both uniformly.
struct AxNode {
    role: String,
    name: String,
    /// The CDP backend DOM node id used to act on the element later.
    backend_dom_node_id: Option<i64>,
    /// Whether CDP marked the node as ignored / decorative (skip it).
    ignored: bool,
    /// Whether the node is a sensitive input whose name must be redacted.
    secret: bool,
}

/// Pull a `{ "value": X }`-wrapped string (CDP form) *or* a bare string out of a
/// JSON field. CDP wraps role/name as `{ "value": "button" }`; the simplified
/// shape uses a plain `"button"`. Returns `""` when absent/unparseable.
fn extract_value_string(field: Option<&Value>) -> String {
    match field {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(o)) => o
            .get("value")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    }
}

/// Decide whether a node represents a secret/sensitive input.
///
/// We honour three signals so callers and fixtures have an easy way to flag it:
///   - a top-level `"secret": true` (simplified shape / explicit flag),
///   - a CDP `properties` entry of the form `{ "name": "secret"/"protected",
///     "value": { "value": true } }` (mirrors how CDP exposes booleans),
///   - the AX role being `"password"` or a name that is itself the literal
///     `"password"` is intentionally *not* used — role-based heuristics are too
///     blunt; the engine passes an explicit secret-ref set instead (below).
fn node_is_secret(node: &Value) -> bool {
    if node.get("secret").and_then(|v| v.as_bool()).unwrap_or(false) {
        return true;
    }
    if let Some(props) = node.get("properties").and_then(|p| p.as_array()) {
        for prop in props {
            let pname = prop.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if pname == "secret" || pname == "protected" {
                // CDP nests the boolean as { value: { value: true } }.
                let val = prop
                    .get("value")
                    .and_then(|v| v.get("value"))
                    .and_then(|v| v.as_bool())
                    .or_else(|| prop.get("value").and_then(|v| v.as_bool()))
                    .unwrap_or(false);
                if val {
                    return true;
                }
            }
        }
    }
    false
}

/// Normalise a single JSON node into [`AxNode`], working for both input shapes.
fn read_node(node: &Value) -> AxNode {
    AxNode {
        role: extract_value_string(node.get("role")),
        name: extract_value_string(node.get("name")),
        backend_dom_node_id: node.get("backendDOMNodeId").and_then(|v| v.as_i64()),
        ignored: node.get("ignored").and_then(|v| v.as_bool()).unwrap_or(false),
        secret: node_is_secret(node),
    }
}

// ---------------------------------------------------------------------------
// Serializer state
// ---------------------------------------------------------------------------

/// Mutable accumulator threaded through the recursive walk: the growing outline
/// lines, the `eNN -> backendDOMNodeId` map, and the monotonically increasing ref
/// counter. `secret_refs` lets the caller force-redact specific refs even when
/// the node itself wasn't flagged (e.g. policy-driven redaction).
struct Serializer<'a> {
    lines: Vec<String>,
    refs: HashMap<String, i64>,
    counter: i64,
    /// Caller-supplied set of `eNN` ids that must additionally be redacted.
    secret_refs: &'a std::collections::HashSet<String>,
}

impl<'a> Serializer<'a> {
    /// Allocate the next `eNN` ref id (e1, e2, …) in document order.
    fn next_ref(&mut self) -> String {
        self.counter += 1;
        format!("e{}", self.counter)
    }
}

/// Emit one outline line for `node` at the given indent `depth`, returning whether
/// the node was actually emitted (so callers don't double-indent skipped nodes).
///
/// Indentation is two spaces per depth level; every line starts with `- ` so the
/// outline reads as a nested Markdown-ish list:
///   `- textbox "Email" [ref=e5]`
///   `  - button "Sign in" [ref=e6]`
fn emit_node(ser: &mut Serializer, node: &AxNode) -> bool {
    // Skip ignored / decorative nodes entirely — they carry no value for the
    // agent and only add noise.
    if node.ignored {
        return false;
    }

    let role = node.role.as_str();
    let actionable = is_actionable_role(role);
    let context = is_context_role(role);

    // Anything that is neither actionable nor structural context (generic,
    // text, none, presentation, …) is dropped to keep the outline compact.
    if !actionable && !context {
        return false;
    }

    if actionable {
        // Actionable nodes get a stable ref + a slot in the resolution map.
        let ref_id = ser.next_ref();

        // Redact the visible name if the node is secret OR the caller flagged
        // this ref for redaction.
        let is_secret = node.secret || ser.secret_refs.contains(&ref_id);
        let display_name = redact_secret_value(&node.name, is_secret);

        ser.lines
            .push(format!("- {} \"{}\" [ref={}]", role, display_name, ref_id));

        // Only record a mapping when we actually know the backend node id; a
        // missing id still produces an outline line but cannot be acted upon.
        if let Some(id) = node.backend_dom_node_id {
            ser.refs.insert(ref_id, id);
        }
    } else {
        // Context nodes: emit for orientation, no ref, no map entry.
        ser.lines
            .push(format!("- {} \"{}\"", role, node.name));
    }

    true
}

/// Recursively walk the **nested** shape (`children` arrays of full node objects).
fn walk_nested(ser: &mut Serializer, node: &Value, depth: usize) {
    let parsed = read_node(node);
    let emitted = emit_node_indented(ser, &parsed, depth);
    // Children indent one level deeper *only* if the parent itself was emitted;
    // otherwise we flatten through the skipped node so structure isn't lost.
    let child_depth = if emitted { depth + 1 } else { depth };
    if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
        for child in children {
            walk_nested(ser, child, child_depth);
        }
    }
}

/// Recursively walk the **flat CDP** shape using a `nodeId -> node` index and the
/// `childIds` edges. `visited` guards against malformed cyclic trees.
fn walk_flat(
    ser: &mut Serializer,
    index: &HashMap<String, &Value>,
    node_id: &str,
    depth: usize,
    visited: &mut std::collections::HashSet<String>,
) {
    if !visited.insert(node_id.to_string()) {
        return; // already seen — avoid infinite loops on bad input
    }
    let Some(node) = index.get(node_id) else {
        return;
    };
    let parsed = read_node(node);
    let emitted = emit_node_indented(ser, &parsed, depth);
    let child_depth = if emitted { depth + 1 } else { depth };

    if let Some(child_ids) = node.get("childIds").and_then(|c| c.as_array()) {
        for cid in child_ids {
            if let Some(cid) = cid.as_str() {
                walk_flat(ser, index, cid, child_depth, visited);
            }
        }
    }
}

/// [`emit_node`] but prefixing the configured indent for `depth`. Returns whether
/// the node was emitted so the walkers can compute child depth correctly.
fn emit_node_indented(ser: &mut Serializer, node: &AxNode, depth: usize) -> bool {
    let before = ser.lines.len();
    let emitted = emit_node(ser, node);
    if emitted {
        // Re-indent the line we just pushed. We build the line un-indented in
        // emit_node (so it stays easy to unit-test) and apply the indent here.
        if let Some(last) = ser.lines.get_mut(before) {
            let indent = "  ".repeat(depth);
            *last = format!("{}{}", indent, last);
        }
    }
    emitted
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Serialize a CDP accessibility tree into an agent-readable outline plus the
/// `eNN -> backendDOMNodeId` resolution map.
///
/// Accepts either input shape documented at the top of this module (flat CDP
/// `{ nodes: [...] }` or a simplified nested `{ role, name, children }`). Ignored
/// / decorative and non-interactive/non-context nodes are skipped. Actionable
/// roles receive a stable `eNN` ref (assigned in document order) and a map entry;
/// headings/landmarks are emitted as context lines without a ref.
///
/// Equivalent to calling [`serialize_ax_tree_with_secrets`] with an empty secret
/// set — secret redaction then derives solely from per-node flags.
///
/// Returns `(outline, refs)` where `outline` is newline-joined and `refs` maps
/// each emitted ref to its backend DOM node id.
pub fn serialize_ax_tree(raw: &Value) -> (String, HashMap<String, i64>) {
    serialize_ax_tree_with_secrets(raw, &std::collections::HashSet::new())
}

/// Like [`serialize_ax_tree`] but additionally force-redacts any ref present in
/// `secret_refs`. Used when policy (not just the page) marks a control sensitive.
pub fn serialize_ax_tree_with_secrets(
    raw: &Value,
    secret_refs: &std::collections::HashSet<String>,
) -> (String, HashMap<String, i64>) {
    let mut ser = Serializer {
        lines: Vec::new(),
        refs: HashMap::new(),
        counter: 0,
        secret_refs,
    };

    if let Some(nodes) = raw.get("nodes").and_then(|n| n.as_array()) {
        // --- Flat CDP form -------------------------------------------------
        // Build a nodeId -> node index, then discover the root(s): any node not
        // referenced as a child. Falling back to the first node keeps a single
        // detached tree working.
        let mut index: HashMap<String, &Value> = HashMap::new();
        let mut child_set: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut order: Vec<String> = Vec::new();

        for node in nodes {
            if let Some(id) = node.get("nodeId").and_then(|v| v.as_str()) {
                index.insert(id.to_string(), node);
                order.push(id.to_string());
            }
            if let Some(child_ids) = node.get("childIds").and_then(|c| c.as_array()) {
                for cid in child_ids {
                    if let Some(cid) = cid.as_str() {
                        child_set.insert(cid.to_string());
                    }
                }
            }
        }

        let mut visited = std::collections::HashSet::new();
        let roots: Vec<String> = order
            .iter()
            .filter(|id| !child_set.contains(*id))
            .cloned()
            .collect();
        // If every node is someone's child (shouldn't happen, but be safe),
        // start from the first node in document order.
        let roots = if roots.is_empty() {
            order.first().cloned().into_iter().collect()
        } else {
            roots
        };
        for root in roots {
            walk_flat(&mut ser, &index, &root, 0, &mut visited);
        }
    } else {
        // --- Simplified nested form ---------------------------------------
        walk_nested(&mut ser, raw, 0);
    }

    (ser.lines.join("\n"), ser.refs)
}

/// Resolve an `eNN` ref back to its CDP `backendDOMNodeId`, or `None` if the ref
/// is unknown (stale snapshot, typo from the model, etc.).
pub fn resolve_ref(map: &HashMap<String, i64>, ref_id: &str) -> Option<i64> {
    map.get(ref_id).copied()
}

/// Return the display value for a control name, redacting to `***` when the
/// control is secret. Centralised so every emission path redacts identically and
/// a secret value can never leak into the model-visible outline.
pub fn redact_secret_value(name: &str, is_secret: bool) -> String {
    if is_secret {
        "***".to_string()
    } else {
        name.to_string()
    }
}

/// Query parameter keys that carry credentials/secrets and must be stripped from
/// any URL before the engine navigates to it or writes it to a log. Matched
/// case-insensitively.
const CREDENTIAL_PARAM_KEYS: &[&str] = &["token", "access_token", "code", "api_key", "password"];

/// Remove credential-bearing query parameters (`token`, `access_token`, `code`,
/// `api_key`, `password`) from `url`, preserving every other part of the URL
/// (scheme, host, path, remaining query params, fragment) and the original order
/// of the params that are kept.
///
/// Pure string surgery (no network, no external crate) so it is trivially tested
/// and safe to call on every navigation/log path. If the URL has no query string
/// it is returned unchanged.
pub fn strip_query_credentials(url: &str) -> String {
    // Split off the fragment first so we can re-attach it untouched.
    let (without_fragment, fragment) = match url.split_once('#') {
        Some((base, frag)) => (base, Some(frag)),
        None => (url, None),
    };

    // Split base from the query string.
    let (base, query) = match without_fragment.split_once('?') {
        Some((b, q)) => (b, q),
        None => return url.to_string(), // nothing to scrub
    };

    // Keep only params whose key is not a credential key (case-insensitive).
    let kept: Vec<&str> = query
        .split('&')
        .filter(|pair| {
            if pair.is_empty() {
                return false;
            }
            let key = pair.split_once('=').map(|(k, _)| k).unwrap_or(pair);
            let key_lower = key.to_ascii_lowercase();
            !CREDENTIAL_PARAM_KEYS.contains(&key_lower.as_str())
        })
        .collect();

    // Reassemble: base + (?kept)? + (#fragment)?
    let mut out = String::from(base);
    if !kept.is_empty() {
        out.push('?');
        out.push_str(&kept.join("&"));
    }
    if let Some(frag) = fragment {
        out.push('#');
        out.push_str(frag);
    }
    out
}

// ---------------------------------------------------------------------------
// Console ring buffer
// ---------------------------------------------------------------------------

/// Default cap for the console capture ring: 10,000 lines. A chatty page can emit
/// unbounded console output, so we keep only the most recent `cap` lines.
pub const CONSOLE_RING_CAP: usize = 10_000;

/// A bounded FIFO ring buffer for forwarded page console messages.
///
/// Pushing past `cap` evicts the oldest line, so memory stays bounded regardless
/// of how noisy the page is. Drained by the (deferred) `browser_cdp_read_console`
/// command. Constructed with [`ConsoleRing::new`] (custom cap) or
/// [`ConsoleRing::default`] (the 10k [`CONSOLE_RING_CAP`]).
pub struct ConsoleRing {
    cap: usize,
    buf: VecDeque<String>,
}

impl ConsoleRing {
    /// Create a ring with the given capacity. A `cap` of 0 is coerced to 1 so the
    /// buffer always retains at least the most recent line.
    pub fn new(cap: usize) -> Self {
        ConsoleRing {
            cap: cap.max(1),
            buf: VecDeque::new(),
        }
    }

    /// Push a console line, evicting the oldest if we are at capacity.
    pub fn push(&mut self, line: impl Into<String>) {
        if self.buf.len() >= self.cap {
            self.buf.pop_front();
        }
        self.buf.push_back(line.into());
    }

    /// Number of lines currently retained.
    pub fn len(&self) -> usize {
        self.buf.len()
    }

    /// Whether the buffer is empty.
    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    /// Snapshot the retained lines, oldest first, without draining them.
    pub fn lines(&self) -> Vec<String> {
        self.buf.iter().cloned().collect()
    }

    /// Drain and return all retained lines, oldest first, emptying the ring.
    pub fn drain(&mut self) -> Vec<String> {
        self.buf.drain(..).collect()
    }
}

impl Default for ConsoleRing {
    /// A ring at the 10k [`CONSOLE_RING_CAP`] default.
    fn default() -> Self {
        ConsoleRing::new(CONSOLE_RING_CAP)
    }
}

// ---------------------------------------------------------------------------
// DEFERRED: chromiumoxide engine surface (needs the `chromiumoxide` crate)
// ---------------------------------------------------------------------------

/// The CDP automation engine contract. Kept as a trait so the command layer and
/// the pure core (this module) compile and test today, while the concrete
/// chromiumoxide-backed implementation is added behind the crate later.
///
/// DEFERRED — the only implementor (`ChromiumoxideEngine`) needs the
/// `chromiumoxide` crate + a tokio runtime + a launched Chromium process. Each
/// method's body is the I/O half; the *data shaping* (serialize/resolve/redact/
/// strip) it relies on is already implemented and tested above.
pub trait BrowserEngine: Send {
    /// Navigate to `url` (caller must pre-scrub via [`strip_query_credentials`]).
    fn navigate(&mut self, url: &str) -> Result<(), String>;
    /// Fetch + serialize the AX tree into `(outline, refs)`.
    fn get_ax_tree(&mut self) -> Result<(String, HashMap<String, i64>), String>;
    /// Click the element behind `backend_dom_node_id` (from [`resolve_ref`]).
    fn click(&mut self, backend_dom_node_id: i64) -> Result<(), String>;
    /// Type `text` into the element behind `backend_dom_node_id`.
    fn type_text(&mut self, backend_dom_node_id: i64, text: &str) -> Result<(), String>;
    /// Capture a PNG screenshot, returned base64-encoded.
    fn screenshot(&mut self) -> Result<String, String>;
    /// Evaluate `expression` in the page and return its JSON result.
    fn eval(&mut self, expression: &str) -> Result<Value, String>;
    /// Drain captured console lines (backed by a [`ConsoleRing`]).
    fn read_console(&mut self) -> Vec<String>;
    /// Drain captured network request records (URLs credential-scrubbed).
    fn read_network(&mut self) -> Vec<Value>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashSet;

    /// A small CDP flat-form login form fixture exercising the serializer.
    /// Node ids: 1 (root form) -> [2 heading, 3 email textbox, 4 password
    /// textbox(secret), 5 submit button]. backendDOMNodeIds are distinct so the
    /// resolution map can be asserted.
    fn login_fixture() -> Value {
        json!({
            "nodes": [
                { "nodeId": "1", "ignored": false,
                  "role": { "value": "form" }, "name": { "value": "Login" },
                  "childIds": ["2", "3", "4", "5"] },
                { "nodeId": "2", "ignored": false,
                  "role": { "value": "heading" }, "name": { "value": "Sign in to your account" },
                  "childIds": [] },
                { "nodeId": "3", "ignored": false,
                  "role": { "value": "textbox" }, "name": { "value": "Email" },
                  "backendDOMNodeId": 101, "childIds": [] },
                { "nodeId": "4", "ignored": false,
                  "role": { "value": "textbox" }, "name": { "value": "Password" },
                  "backendDOMNodeId": 102, "secret": true, "childIds": [] },
                { "nodeId": "5", "ignored": false,
                  "role": { "value": "button" }, "name": { "value": "Sign in" },
                  "backendDOMNodeId": 103, "childIds": [] }
            ]
        })
    }

    #[test]
    fn serializes_interactive_refs() {
        let (outline, refs) = serialize_ax_tree(&login_fixture());

        // Refs are assigned in document order to actionable nodes only:
        //   e1 -> Email textbox, e2 -> Password textbox, e3 -> Sign in button.
        // The form (context root) and heading get no ref.
        let expected = "\
- form \"Login\"
  - heading \"Sign in to your account\"
  - textbox \"Email\" [ref=e1]
  - textbox \"***\" [ref=e2]
  - button \"Sign in\" [ref=e3]";
        assert_eq!(outline, expected);

        // The resolution map points each ref at its backend DOM node id.
        assert_eq!(refs.get("e1"), Some(&101)); // Email
        assert_eq!(refs.get("e2"), Some(&102)); // Password
        assert_eq!(refs.get("e3"), Some(&103)); // Sign in
        assert_eq!(refs.len(), 3);
    }

    #[test]
    fn serializes_interactive_refs_e5_in_larger_tree() {
        // A tree where the 5th actionable node lands on e5, asserting the
        // document-order ref numbering and the e5 -> backendDOMNodeId mapping.
        let tree = json!({
            "nodes": [
                { "nodeId": "r", "role": { "value": "main" }, "name": { "value": "App" },
                  "childIds": ["a", "b", "c", "d", "e"] },
                { "nodeId": "a", "role": { "value": "link" }, "name": { "value": "Home" },
                  "backendDOMNodeId": 1, "childIds": [] },
                { "nodeId": "b", "role": { "value": "link" }, "name": { "value": "Docs" },
                  "backendDOMNodeId": 2, "childIds": [] },
                { "nodeId": "c", "role": { "value": "checkbox" }, "name": { "value": "Remember me" },
                  "backendDOMNodeId": 3, "childIds": [] },
                { "nodeId": "d", "role": { "value": "textbox" }, "name": { "value": "Search" },
                  "backendDOMNodeId": 4, "childIds": [] },
                { "nodeId": "e", "role": { "value": "button" }, "name": { "value": "Go" },
                  "backendDOMNodeId": 555, "childIds": [] }
            ]
        });
        let (_outline, refs) = serialize_ax_tree(&tree);
        // 5th actionable node -> e5 -> its backendDOMNodeId 555.
        assert_eq!(resolve_ref(&refs, "e5"), Some(555));
    }

    #[test]
    fn ignores_decorative_nodes() {
        // A tree mixing ignored nodes and non-interactive/non-context roles
        // (generic/text/presentation) — all must be dropped from the outline.
        let tree = json!({
            "nodes": [
                { "nodeId": "1", "role": { "value": "main" }, "name": { "value": "Page" },
                  "childIds": ["2", "3", "4", "5"] },
                { "nodeId": "2", "ignored": true,
                  "role": { "value": "button" }, "name": { "value": "Hidden" },
                  "backendDOMNodeId": 9, "childIds": [] },
                { "nodeId": "3", "role": { "value": "generic" }, "name": { "value": "" },
                  "childIds": [] },
                { "nodeId": "4", "role": { "value": "presentation" }, "name": { "value": "decor" },
                  "childIds": [] },
                { "nodeId": "5", "role": { "value": "button" }, "name": { "value": "Real" },
                  "backendDOMNodeId": 10, "childIds": [] }
            ]
        });
        let (outline, refs) = serialize_ax_tree(&tree);
        // Only the main landmark (context) + the real button survive.
        let expected = "\
- main \"Page\"
  - button \"Real\" [ref=e1]";
        assert_eq!(outline, expected);
        // The ignored button never got a ref; the real one is e1.
        assert_eq!(refs.len(), 1);
        assert_eq!(resolve_ref(&refs, "e1"), Some(10));
    }

    #[test]
    fn redacts_secret_ref_value() {
        // Direct unit on the redaction helper.
        assert_eq!(redact_secret_value("hunter2", true), "***");
        assert_eq!(redact_secret_value("Email", false), "Email");

        // Via the serializer: a node flagged secret renders its name as ***.
        let (outline, _refs) = serialize_ax_tree(&login_fixture());
        assert!(outline.contains("textbox \"***\" [ref=e2]"));
        // And the non-secret email name is untouched.
        assert!(outline.contains("textbox \"Email\" [ref=e1]"));
    }

    #[test]
    fn redacts_caller_supplied_secret_ref() {
        // Even when the node isn't self-flagged, a ref in the secret set is
        // redacted. e1 (Email) is normally clear text; force-redact it.
        let mut secrets = HashSet::new();
        secrets.insert("e1".to_string());
        let (outline, _refs) = serialize_ax_tree_with_secrets(&login_fixture(), &secrets);
        assert!(outline.contains("textbox \"***\" [ref=e1]"));
    }

    #[test]
    fn strips_query_credentials_from_nav_url() {
        // The headline case: an OAuth callback — drop `code`, keep `keep`.
        assert_eq!(
            strip_query_credentials("https://x.com/cb?code=abc&keep=1"),
            "https://x.com/cb?keep=1"
        );
        // All credential keys removed, order of kept params preserved.
        assert_eq!(
            strip_query_credentials(
                "https://api.example.com/p?a=1&token=secret&b=2&api_key=K&c=3"
            ),
            "https://api.example.com/p?a=1&b=2&c=3"
        );
        // Case-insensitive key match, and the fragment is preserved untouched.
        assert_eq!(
            strip_query_credentials("https://x.com/p?Access_Token=z&ok=1#frag"),
            "https://x.com/p?ok=1#frag"
        );
        // When only credentials are present, the '?' is dropped entirely.
        assert_eq!(
            strip_query_credentials("https://x.com/p?password=pw"),
            "https://x.com/p"
        );
        // No query string -> returned unchanged.
        assert_eq!(
            strip_query_credentials("https://x.com/path"),
            "https://x.com/path"
        );
    }

    #[test]
    fn console_ring_cap_eviction() {
        // Cap of 3: pushing 5 lines retains only the last 3, oldest evicted.
        let mut ring = ConsoleRing::new(3);
        ring.push("1");
        ring.push("2");
        ring.push("3");
        ring.push("4");
        ring.push("5");
        assert_eq!(ring.len(), 3);
        assert_eq!(ring.lines(), vec!["3", "4", "5"]);

        // Drain empties the ring and returns oldest-first.
        let drained = ring.drain();
        assert_eq!(drained, vec!["3", "4", "5"]);
        assert!(ring.is_empty());
    }

    #[test]
    fn console_ring_default_cap_is_10k() {
        let ring = ConsoleRing::default();
        // We can't read cap directly, but pushing 10_001 lines should retain 10k.
        let mut ring = ring;
        for i in 0..(CONSOLE_RING_CAP + 1) {
            ring.push(i.to_string());
        }
        assert_eq!(ring.len(), CONSOLE_RING_CAP);
        // The very first line (0) was evicted; the last is 10_000.
        let lines = ring.lines();
        assert_eq!(lines.first().map(String::as_str), Some("1"));
        assert_eq!(
            lines.last().map(String::as_str),
            Some(CONSOLE_RING_CAP.to_string().as_str())
        );
    }

    #[test]
    fn resolve_ref_none_for_unknown() {
        let (_outline, refs) = serialize_ax_tree(&login_fixture());
        assert_eq!(resolve_ref(&refs, "e999"), None);
        assert_eq!(resolve_ref(&refs, "nonsense"), None);
        // Known ref still resolves.
        assert_eq!(resolve_ref(&refs, "e1"), Some(101));
    }

    #[test]
    fn serializes_simplified_nested_shape() {
        // The serializer also accepts the nested { role, name, children } form.
        let tree = json!({
            "role": "main", "name": "Home",
            "children": [
                { "role": "heading", "name": "Welcome", "children": [] },
                { "role": "link", "name": "Sign up", "backendDOMNodeId": 7, "children": [] },
                { "role": "textbox", "name": "Token", "secret": true,
                  "backendDOMNodeId": 8, "children": [] }
            ]
        });
        let (outline, refs) = serialize_ax_tree(&tree);
        let expected = "\
- main \"Home\"
  - heading \"Welcome\"
  - link \"Sign up\" [ref=e1]
  - textbox \"***\" [ref=e2]";
        assert_eq!(outline, expected);
        assert_eq!(resolve_ref(&refs, "e1"), Some(7));
        assert_eq!(resolve_ref(&refs, "e2"), Some(8));
    }
}
