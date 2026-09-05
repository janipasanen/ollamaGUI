//! Chromium automation engine over CDP (#73).
//!
//! Drives a real Chromium via `chromiumoxide` (tokio runtime). The engine is the
//! agent's eyes/hands: navigate, click/type by accessibility `ref=eNN`, snapshot
//! the AX tree (serialized by the unit-tested [`crate::ax`] module), screenshot,
//! eval, and read console. A single active page + its `eNN -> backendDOMNodeId`
//! map are held in a process-global behind a `tokio::sync::Mutex`.
//!
//! The Chromium binary is resolved by [`crate::browser_chromium`] (#68). Live
//! end-to-end driving needs a Chromium install + a display; the AX serializer
//! and helpers are unit-tested independently.

use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine as _;
use chromiumoxide::cdp::browser_protocol::accessibility::GetFullAxTreeParams;
use chromiumoxide::cdp::browser_protocol::dom::{BackendNodeId, ResolveNodeParams};
use chromiumoxide::cdp::browser_protocol::input::InsertTextParams;
use chromiumoxide::cdp::browser_protocol::page::CaptureScreenshotFormat;
use chromiumoxide::cdp::js_protocol::runtime::CallFunctionOnParams;
use chromiumoxide::page::ScreenshotParams;
use chromiumoxide::{Browser, BrowserConfig};
use futures::StreamExt;
use lazy_static::lazy_static;
use serde::Serialize;
use tokio::sync::Mutex;

use crate::ax::{self, ConsoleRing, NetworkEntry, NetworkRing};

/// One live engine: the browser, its background event-handler task, the active
/// page, and the latest snapshot ref map (invalidated on every new snapshot).
struct Engine {
    browser: Browser,
    page: chromiumoxide::Page,
    handler: tokio::task::JoinHandle<()>,
    refs: HashMap<String, i64>,
    console: Arc<Mutex<ConsoleRing>>,
    network: Arc<Mutex<NetworkRing>>,
}

lazy_static! {
    static ref ENGINE: Mutex<Option<Engine>> = Mutex::new(None);
}

const CONSOLE_CAP: usize = 1000;
const NETWORK_CAP: usize = 500;

#[derive(Serialize)]
pub struct NavResult {
    pub url: String,
    pub title: String,
}

#[derive(Serialize)]
pub struct ConsoleEntry {
    pub text: String,
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/// Launch a Chromium instance (visible unless `headless`) using the resolved
/// system/downloaded Chromium path, spawn its event handler, and open one page.
#[tauri::command]
pub async fn browser_engine_start(headless: Option<bool>) -> Result<(), String> {
    let mut slot = ENGINE.lock().await;
    if slot.is_some() {
        return Ok(()); // already running — idempotent
    }

    // Resolve a Chromium binary (#68). chromiumoxide also probes, but we prefer
    // the explicit, detected path.
    let chromium_path = crate::browser_chromium::resolve_system_path();
    let mut builder = BrowserConfig::builder();
    if let Some(path) = chromium_path.as_ref() {
        builder = builder.chrome_executable(path);
    }
    if !headless.unwrap_or(false) {
        builder = builder.with_head();
    }
    let config = builder.build().map_err(|e| format!("Browser config: {e}"))?;

    let (browser, mut handler) = Browser::launch(config)
        .await
        .map_err(|e| format!("Failed to launch Chromium (is it installed? see browser_chromium_status): {e}"))?;

    let handle = tokio::task::spawn(async move {
        while handler.next().await.is_some() {}
    });

    let page = browser
        .new_page("about:blank")
        .await
        .map_err(|e| format!("Failed to open page: {e}"))?;

    // The Network domain is off by default; without this no request events
    // are delivered at all (#628).
    let _ = page
        .execute(chromiumoxide::cdp::browser_protocol::network::EnableParams::default())
        .await;
    let _ = page
        .execute(chromiumoxide::cdp::js_protocol::runtime::EnableParams::default())
        .await;

    let console = Arc::new(Mutex::new(ConsoleRing::new(CONSOLE_CAP)));
    let network = Arc::new(Mutex::new(NetworkRing::new(NETWORK_CAP)));
    spawn_event_pumps(&page, console.clone(), network.clone()).await;

    *slot = Some(Engine {
        browser,
        page,
        handler: handle,
        refs: HashMap::new(),
        console,
        network,
    });
    Ok(())
}

/// Stop the engine and tear down the browser + handler task.
#[tauri::command]
pub async fn browser_engine_stop() -> Result<(), String> {
    let mut slot = ENGINE.lock().await;
    if let Some(mut engine) = slot.take() {
        let _ = engine.browser.close().await;
        engine.handler.abort();
    }
    Ok(())
}

/// Subscribe to the CDP event streams and feed the rings (#628, #629).
///
/// Each listener owns its own task because `event_listener` yields one typed
/// stream per event kind. The rings are behind `Arc<Mutex<…>>` so the pumps and
/// the read commands can touch them independently — the engine mutex is held
/// across `await`s elsewhere, and blocking these pumps on it would drop events.
async fn spawn_event_pumps(
    page: &chromiumoxide::Page,
    console: Arc<Mutex<ConsoleRing>>,
    network: Arc<Mutex<NetworkRing>>,
) {
    use chromiumoxide::cdp::browser_protocol::network::{
        EventLoadingFailed, EventRequestWillBeSent, EventResponseReceived,
    };
    use chromiumoxide::cdp::js_protocol::runtime::EventConsoleApiCalled;

    if let Ok(mut ev) = page.event_listener::<EventRequestWillBeSent>().await {
        let ring = network.clone();
        tokio::task::spawn(async move {
            while let Some(e) = ev.next().await {
                ring.lock().await.push_request(
                    e.request_id.inner().clone(),
                    e.request.method.clone(),
                    // Strip credentials from the URL before it is stored: query
                    // tokens are exactly as sensitive as an auth header.
                    ax::strip_query_credentials(&e.request.url),
                );
            }
        });
    }

    if let Ok(mut ev) = page.event_listener::<EventResponseReceived>().await {
        let ring = network.clone();
        tokio::task::spawn(async move {
            while let Some(e) = ev.next().await {
                ring.lock().await.complete(
                    e.request_id.inner(),
                    e.response.status,
                    &e.response.status_text,
                    &e.response.mime_type,
                );
            }
        });
    }

    if let Ok(mut ev) = page.event_listener::<EventLoadingFailed>().await {
        let ring = network.clone();
        tokio::task::spawn(async move {
            while let Some(e) = ev.next().await {
                ring.lock().await.fail(e.request_id.inner(), &e.error_text);
            }
        });
    }

    if let Ok(mut ev) = page.event_listener::<EventConsoleApiCalled>().await {
        let ring = console.clone();
        tokio::task::spawn(async move {
            while let Some(e) = ev.next().await {
                // Render each argument's value; CDP sends structured
                // RemoteObjects rather than the formatted line the devtools
                // console shows.
                let line = e
                    .args
                    .iter()
                    .map(|a| {
                        a.value
                            .as_ref()
                            .map(|v| match v {
                                serde_json::Value::String(s) => s.clone(),
                                other => other.to_string(),
                            })
                            .or_else(|| a.description.clone())
                            .unwrap_or_default()
                    })
                    .collect::<Vec<_>>()
                    .join(" ");
                ring.lock().await.push(line);
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Driver commands
// ---------------------------------------------------------------------------

/// Navigate to `url`; returns the (credential-stripped) URL + page title.
#[tauri::command]
pub async fn browser_cdp_navigate(url: String) -> Result<NavResult, String> {
    let mut slot = ENGINE.lock().await;
    let engine = slot.as_mut().ok_or("Engine not started")?;
    engine.page.goto(&url).await.map_err(|e| e.to_string())?;
    engine.page.wait_for_navigation().await.map_err(|e| e.to_string())?;
    let title = engine.page.get_title().await.map_err(|e| e.to_string())?.unwrap_or_default();
    let landed = engine.page.url().await.map_err(|e| e.to_string())?.unwrap_or(url);
    // Strip credential query params from the returned url so secrets never
    // re-enter the model via a navigation result (#73).
    Ok(NavResult { url: ax::strip_query_credentials(&landed), title })
}

/// Snapshot the accessibility tree as a `ref=eNN` outline and store the fresh
/// ref map (old refs invalidate).
#[tauri::command]
pub async fn browser_cdp_get_ax_tree() -> Result<String, String> {
    let mut slot = ENGINE.lock().await;
    let engine = slot.as_mut().ok_or("Engine not started")?;
    let result = engine
        .page
        .execute(GetFullAxTreeParams::default())
        .await
        .map_err(|e| e.to_string())?;
    // Feed the CDP node list to the unit-tested serializer.
    let nodes = serde_json::to_value(&result.result.nodes).map_err(|e| e.to_string())?;
    let raw = serde_json::json!({ "nodes": nodes });
    let (outline, map) = ax::serialize_ax_tree(&raw);
    engine.refs = map;
    Ok(outline)
}

/// Resolve a snapshot ref to a backend DOM node id, returning the JS object id.
async fn resolve_object_id(page: &chromiumoxide::Page, backend_node_id: i64) -> Result<String, String> {
    let resolved = page
        .execute(ResolveNodeParams {
            node_id: None,
            backend_node_id: Some(BackendNodeId::new(backend_node_id)),
            object_group: None,
            execution_context_id: None,
        })
        .await
        .map_err(|e| e.to_string())?;
    resolved
        .result
        .object
        .object_id
        .clone()
        .map(|id| id.inner().clone())
        .ok_or_else(|| "Node has no JS object id".to_string())
}

/// Click the element referenced by `ref_id` from the latest snapshot.
#[tauri::command]
pub async fn browser_cdp_click(ref_id: String) -> Result<(), String> {
    let mut slot = ENGINE.lock().await;
    let engine = slot.as_mut().ok_or("Engine not started")?;
    let backend = ax::resolve_ref(&engine.refs, &ref_id)
        .ok_or_else(|| format!("Unknown ref '{ref_id}' (snapshot may be stale)."))?;
    let object_id = resolve_object_id(&engine.page, backend).await?;
    // Scroll into view + click via the element's own click() for reliability.
    let params = CallFunctionOnParams::builder()
        .function_declaration("function(){ this.scrollIntoView({block:'center'}); this.click(); }")
        .object_id(object_id)
        .build()
        .map_err(|e| e.to_string())?;
    engine.page.execute(params).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Type `text` into the element referenced by `ref_id`; optionally submit (Enter).
#[tauri::command]
pub async fn browser_cdp_type(ref_id: String, text: String, submit: Option<bool>) -> Result<(), String> {
    let mut slot = ENGINE.lock().await;
    let engine = slot.as_mut().ok_or("Engine not started")?;
    let backend = ax::resolve_ref(&engine.refs, &ref_id)
        .ok_or_else(|| format!("Unknown ref '{ref_id}' (snapshot may be stale)."))?;
    let object_id = resolve_object_id(&engine.page, backend).await?;
    // Focus the element, then insert the text via the Input domain.
    let focus = CallFunctionOnParams::builder()
        .function_declaration("function(){ this.focus(); if('value' in this){ this.value=''; } }")
        .object_id(object_id)
        .build()
        .map_err(|e| e.to_string())?;
    engine.page.execute(focus).await.map_err(|e| e.to_string())?;
    engine
        .page
        .execute(InsertTextParams { text })
        .await
        .map_err(|e| e.to_string())?;
    if submit.unwrap_or(false) {
        // Submit by evaluating a form submit / Enter keypress on the active element.
        engine
            .page
            .evaluate("document.activeElement && document.activeElement.form && document.activeElement.form.requestSubmit && document.activeElement.form.requestSubmit()")
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Capture a screenshot as a base64 PNG (data part only, no data: prefix).
#[tauri::command]
pub async fn browser_cdp_screenshot(full_page: Option<bool>) -> Result<String, String> {
    let mut slot = ENGINE.lock().await;
    let engine = slot.as_mut().ok_or("Engine not started")?;
    let params = ScreenshotParams::builder()
        .format(CaptureScreenshotFormat::Png)
        .full_page(full_page.unwrap_or(false))
        .build();
    let bytes = engine.page.screenshot(params).await.map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Evaluate a JS expression and return the result as a JSON string.
#[tauri::command]
pub async fn browser_cdp_eval(expression: String) -> Result<String, String> {
    let mut slot = ENGINE.lock().await;
    let engine = slot.as_mut().ok_or("Engine not started")?;
    let eval = engine.page.evaluate(expression).await.map_err(|e| e.to_string())?;
    let value: serde_json::Value = eval.into_value().unwrap_or(serde_json::Value::Null);
    serde_json::to_string(&value).map_err(|e| e.to_string())
}

/// Read the captured network log (optionally clearing it).
///
/// This is the external-site half of `browser_read_network` (#628): the
/// frontend's fetch/XHR patch only reaches same-origin pages, while this path
/// sees every request the real browser makes.
#[tauri::command]
pub async fn browser_cdp_read_network(clear: Option<bool>) -> Result<Vec<NetworkEntry>, String> {
    let slot = ENGINE.lock().await;
    let engine = slot.as_ref().ok_or_else(|| "Engine not started".to_string())?;
    let mut ring = engine.network.lock().await;
    Ok(if clear.unwrap_or(false) { ring.drain() } else { ring.entries() })
}

/// Drain the captured console ring buffer (optionally without clearing).
#[tauri::command]
pub async fn browser_cdp_read_console(clear: Option<bool>) -> Result<Vec<ConsoleEntry>, String> {
    let mut slot = ENGINE.lock().await;
    let engine = slot.as_mut().ok_or("Engine not started")?;
    let lines = if clear.unwrap_or(true) {
        engine.console.lock().await.drain()
    } else {
        engine.console.lock().await.lines()
    };
    Ok(lines.into_iter().map(|text| ConsoleEntry { text }).collect())
}

/// Wait until a CSS selector matches an element, up to `timeout_ms` (#181).
/// Polls every 100 ms using JS. Returns an error string if timed out.
#[tauri::command]
pub async fn browser_cdp_wait_for(selector: String, timeout_ms: Option<u64>) -> Result<(), String> {
    let deadline = std::time::Instant::now()
        + std::time::Duration::from_millis(timeout_ms.unwrap_or(5000));
    let js = format!("document.querySelector({}) !== null", serde_json::to_string(&selector).unwrap_or_default());
    loop {
        {
            let mut slot = ENGINE.lock().await;
            let engine = slot.as_mut().ok_or("Engine not started")?;
            let eval = engine.page.evaluate(js.clone()).await.map_err(|e| e.to_string())?;
            let value: serde_json::Value = eval.into_value().unwrap_or(serde_json::Value::Bool(false));
            if value.as_bool().unwrap_or(false) {
                return Ok(());
            }
        }
        if std::time::Instant::now() >= deadline {
            return Err(format!("Timed out waiting for selector: {selector}"));
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

#[derive(Serialize)]
pub struct AssertResult {
    pub pass: bool,
    pub actual: String,
}

/// Pure evaluation of an assertion result (extracted for unit testing, #415).
///
/// Given the JSON value a page eval returned and an optional `expected` string:
///   - `actual` is the string form (raw string, or JSON stringification otherwise).
///   - `pass` is `actual == expected` when `expected` is given; otherwise the
///     value's truthiness (JS-like: a bool uses its value, non-null is truthy,
///     null/absent is falsy).
fn evaluate_assertion(raw: &serde_json::Value, expected: Option<&str>) -> AssertResult {
    let actual = match raw {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let pass = match expected {
        Some(exp) => actual == exp,
        None => raw.as_bool().unwrap_or(!raw.is_null()),
    };
    AssertResult { pass, actual }
}

/// Evaluate a JS expression and check whether its string representation equals
/// `value` (if given) or is truthy (#181). Returns AssertResult { pass, actual }.
#[tauri::command]
pub async fn browser_cdp_assert(assertion: String, value: Option<String>) -> Result<AssertResult, String> {
    let mut slot = ENGINE.lock().await;
    let engine = slot.as_mut().ok_or("Engine not started")?;
    let eval = engine.page.evaluate(assertion).await.map_err(|e| e.to_string())?;
    let raw: serde_json::Value = eval.into_value().unwrap_or(serde_json::Value::Null);
    Ok(evaluate_assertion(&raw, value.as_deref()))
}

// ---------------------------------------------------------------------------
// #67 spike harness — AX-tree-drives-snapshot→click reliability gate.
// ---------------------------------------------------------------------------
//
// This throwaway harness is #[ignore]d (it needs a real Chromium install + a
// display). It must COMPILE so the spike can be re-run on a machine that has
// Chromium: `cargo test -- --ignored axtree_snapshot_click_loop`. Record the
// per-local-model success rates + token counts in
// docs/spikes/0002-axtree-local-model.md.
#[cfg(test)]
mod spike_harness {
    use super::*;

    #[tokio::test]
    #[ignore = "needs a Chromium install + display (#67 spike harness)"]
    async fn axtree_snapshot_click_loop() {
        browser_engine_start(Some(false)).await.expect("engine start");
        let form = "data:text/html,<input aria-label='Email'><button>Sign in</button>";
        browser_cdp_navigate(form.to_string()).await.expect("navigate");
        let outline = browser_cdp_get_ax_tree().await.expect("ax tree");
        assert!(outline.contains("[ref=e"), "expected actionable refs, got:\n{outline}");
        // A real run would feed `outline` to local models and measure
        // click-by-ref / type-by-ref success. We assert the loop is mechanically
        // possible end-to-end here.
        browser_engine_stop().await.expect("engine stop");
    }
}

// ---------------------------------------------------------------------------
// Runnable unit tests for the pure engine logic (#415). These need no Chromium
// and cover the assertion-evaluation decision table + result serialization.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn assert_string_equals_expected() {
        let r = evaluate_assertion(&json!("Login"), Some("Login"));
        assert!(r.pass);
        assert_eq!(r.actual, "Login");
    }

    #[test]
    fn assert_string_not_equal_expected() {
        let r = evaluate_assertion(&json!("Logout"), Some("Login"));
        assert!(!r.pass);
        assert_eq!(r.actual, "Logout");
    }

    #[test]
    fn assert_number_stringifies_and_compares() {
        // Non-string values compare against their JSON stringification.
        let r = evaluate_assertion(&json!(42), Some("42"));
        assert!(r.pass);
        assert_eq!(r.actual, "42");
        let miss = evaluate_assertion(&json!(42), Some("7"));
        assert!(!miss.pass);
    }

    #[test]
    fn assert_truthy_without_expected() {
        // Bool true → pass; bool false → fail.
        assert!(evaluate_assertion(&json!(true), None).pass);
        assert!(!evaluate_assertion(&json!(false), None).pass);
    }

    #[test]
    fn assert_null_is_falsy_and_nonnull_is_truthy() {
        assert!(!evaluate_assertion(&serde_json::Value::Null, None).pass);
        // Non-null, non-bool (e.g. an object/number) is truthy when no expected value.
        assert!(evaluate_assertion(&json!({"ok": 1}), None).pass);
        assert!(evaluate_assertion(&json!(0), None).pass); // non-null → truthy here
    }

    #[test]
    fn assert_result_serializes_to_expected_shape() {
        let r = evaluate_assertion(&json!("x"), Some("x"));
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v, json!({ "pass": true, "actual": "x" }));
    }

    #[test]
    fn nav_and_console_structs_serialize() {
        let nav = NavResult { url: "https://e.com".into(), title: "E".into() };
        assert_eq!(serde_json::to_value(&nav).unwrap(), json!({ "url": "https://e.com", "title": "E" }));
        let ce = ConsoleEntry { text: "hi".into() };
        assert_eq!(serde_json::to_value(&ce).unwrap(), json!({ "text": "hi" }));
    }
}
