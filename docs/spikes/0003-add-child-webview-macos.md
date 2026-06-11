# Spike 0003 — Tauri unstable `add_child` external-URL webview on macOS

- **Issue:** #69 — SPIKE: de-risk embedding an **external-URL** native child webview via
  Tauri's **unstable `add_child`** API on **macOS**, before the L child-webview
  implementation lands.
- **Status:** Methodology + go/no-go rubric recorded. Observation cells to be filled by
  running the debug-only harness on a real macOS build. **No production embedding code is
  built by this spike.**
- **Gates:** ADR-0001 open-risk (c). The L child-webview impl MUST NOT be built until this
  gate resolves GO. If NO-GO, the browser stays **iframe-only** with external URLs opening in
  the system browser.
- **Decision owner:** browser-rendering track.
- **Primary platform:** `aarch64-apple-darwin` (macOS). Windows/Linux behavior is
  out of scope for this spike and gets its own pass before those builds ship.

This spike is **decision-oriented and throwaway**. It answers two coupled questions:

> 1. Can a Tauri **unstable `add_child`** native child webview, hosting an **external URL**,
>    be embedded inside the app window and made to **track a host `<div>`** as the window and
>    a split pane resize — smoothly enough to ship?
> 2. Does that native child webview **escape iframe embedding restrictions** — specifically,
>    can it load a site that sends `X-Frame-Options: DENY` / a restrictive
>    `frame-ancestors` CSP, which an `<iframe>` cannot? (This is the **decisive reason** to go
>    native over iframe.)

ADR-0001 records `add_child` as "API-unstable and platform-fragile" and names iframe-only as
the documented fallback. This spike replaces that hand-wave with observed macOS behavior.

---

## 1. Why this gate exists

ADR-0001 routes **localhost/dev URLs to an `<iframe>`** (same-trust, CSP-friendly) and
**external URLs to a native child webview** via `add_child`. The native path is the risky
one and it is load-bearing for one specific reason:

- **Iframes are blocked by `X-Frame-Options` / `frame-ancestors`.** A huge fraction of real
  external sites (banks, Google, GitHub, most login pages) refuse to render inside an iframe.
  If the built-in browser is iframe-only, "open this external page" simply **fails to render**
  for those sites — which is most of the interesting ones for agent automation.
- **A native child webview is a separate top-level navigation**, NOT a framed document, so it
  is **not subject to `frame-ancestors`** at all. Confirming this empirically is the single
  most important result of the spike: it is the justification for taking on `add_child`'s
  instability instead of staying iframe-only.

The cost of that justification is `add_child`'s downsides: it is an **unstable** Tauri API,
the child webview is **NOT governed by the app CSP** (ADR-0001 security note), and native
embedding/tracking behavior is **platform-fragile**. The spike measures whether macOS
tracking is good enough to be worth those costs.

---

## 2. Method — debug-only `preview_spike_*` commands behind `cfg(debug_assertions)`

Add three throwaway Tauri commands, compiled **only in debug builds** so they can never ship.
All three are gated `#[cfg(debug_assertions)]` and require Tauri's **`unstable`** feature
(which is itself DEFERRED, see §5):

- `preview_spike_open(url, x, y, w, h)` — call `WebviewWindow`/`Window::add_child` to create
  a child webview at the given bounds, navigated to `url` (an external origin).
- `preview_spike_set_bounds(x, y, w, h)` — reposition/resize the child to track the host div.
- `preview_spike_close()` — tear the child webview down.

### Frontend host + tracking

A debug-only React panel renders:

- A **host `<div>`** that reserves the on-screen rectangle the native pane should occupy.
- A **`ResizeObserver`** on that div + a **window `resize`** listener. On every change it reads
  the div's viewport rect (`getBoundingClientRect()` + device-pixel scaling) and calls
  `preview_spike_set_bounds(...)` so the native child re-tracks the div.
- A **split handle** so the host div can be resized *within* the window (not just by resizing
  the OS window) — this exercises the harder tracking case where the window size is constant
  but the pane geometry changes.

The native child webview has **no DOM relationship** to the React document — it floats above
it in native z-order — so all positioning is manual and driven by these observers. That is
exactly the fragility this spike measures.

### Test URLs

1. **A normal external site** (e.g. `https://example.com`) — baseline: does it render and
   track at all?
2. **An `X-Frame-Options: DENY` / restrictive `frame-ancestors` site** — the decisive test.
   Load the SAME url in (a) a plain `<iframe>` and (b) the native child webview, side by side.
   - Expected: the **iframe is blank/refused** (browser blocks framing).
   - Expected: the **native child webview renders normally** (not subject to frame-ancestors).
   - This contrast IS the go-native justification; capture a screenshot of both.

---

## 3. Observations — fill after running on macOS

Record per test URL on a real `aarch64-apple-darwin` build (debug):

| Observation | example.com (normal) | XFO:DENY / frame-ancestors site |
| --- | --- | --- |
| **Renders?** (child webview shows the page) |  |  |
| **Iframe renders same URL?** (control) |  |  |
| **Tracks on window resize?** (follows OS window resize) |  |  |
| **Tracks on split resize?** (follows in-window pane resize) |  |  |
| **Z-order correct?** (sits above React doc, below app chrome/menus/modals) |  |  |
| **Jank?** (lag/tearing/flicker while dragging — none / mild / severe) |  |  |
| **Teardown clean?** (`preview_spike_close` removes it with no ghost) |  |  |

Free-form notes to capture: does the child webview **clip** to the host div or overhang it;
does it **cover** app menus/modals (z-order inversion); does dragging the window show the
native pane **lagging behind** the div (the classic native-overlay jank); any Tauri
`unstable`-API panics or warnings; whether DPI/retina scaling makes bounds drift.

---

## 4. Go / no-go rubric

The **decisive gate is the frame-ancestors result** plus acceptable tracking:

| Condition | Decision |
| --- | --- |
| XFO/`frame-ancestors` site **renders** in the child webview (iframe control is blocked) **AND** tracks window + split resize with at most **mild** jank **AND** z-order is correct | **GO — build the L native child-webview impl.** The native path delivers the capability iframes cannot, and tracking is shippable. |
| Renders + escapes frame-ancestors, **but** tracking is severely janky or z-order is wrong (covers menus/modals) | **CONDITIONAL.** The capability is real and worth it, but ship with mitigations: debounce/throttle `set_bounds`, hide the native child during drags and re-show on settle, and add explicit z-order management. Re-evaluate after mitigations before committing to L. |
| Child webview does **not** render external URLs, or `add_child` is too unstable/panics on macOS at our Tauri version | **NO-GO (this platform/version).** Stay **iframe-only**; external URLs open in the system browser (see §5 fallback). Re-spike when Tauri's webview API stabilizes or a version bumps. |
| Frame-ancestors site is **also blocked** in the child webview (i.e. native gives no advantage over iframe) | **NO-GO for native.** The entire justification for `add_child` collapses — iframe-only with system-browser handoff is strictly simpler and equally capable. |

The last row is the most important negative result to check: if the native child webview were
*also* subject to frame-ancestors, there would be **no reason** to take on `add_child`'s
instability, and the iframe-only fallback becomes the correct permanent design.

---

## 5. Fallback if NO-GO — iframe-only + system-browser handoff

If the spike lands NO-GO on macOS, the browser degrades exactly as ADR-0001's documented
fallback prescribes, with **no loss of correctness, only of in-app embedding**:

- **Localhost/dev URLs:** keep rendering in the `<iframe>` (`mode: 'iframe'`), unchanged.
  These are same-trust and not frame-blocked, so the iframe path is fully sufficient.
- **External URLs:** instead of an in-app native pane, **open them in the system browser**
  via the **`tauri-plugin-opener`** (already a dependency; ADR-0001 §"Rendering / embedding"
  routes via `isLocalhostUrl()` in `services/browser.ts`). The user gets a real browser with
  full capabilities; ollamaGUI just hands off the URL.
- **Automation features** that strictly require the embedded child webview are **disabled**
  in this mode rather than crashing — consistent with ADR-0001's "disabled there rather than
  crashing" stance and the optional-runtime-detection pattern of `check_mlx_available`.

This fallback is **always the safety net**: even on a GO, the L impl must keep the
iframe-only path working for platforms/versions where `add_child` regresses.

---

## 6. DEFERRED — what this spike does NOT enable now

Per the project "no heavy/unstable additions in this pass" rule, the following are
**DEFERRED** and must NOT be applied by this spike:

- **DEFERRED (needs Tauri `unstable` feature):** enabling Tauri's `unstable` feature flag in
  `src-tauri/Cargo.toml` (required for `add_child`/multi-webview APIs). ADR-0002 already
  stages the webview capability identifiers and marks the `unstable` feature as deferred;
  this spike does not turn it on.
- **DEFERRED (needs runtime):** the real bodies of `preview_spike_open/set_bounds/close`.
  They are described here as commented pseudo-Rust and ship only as a **`#[cfg(debug_assertions)]`
  + `#[ignore]` test stub** that compiles std-only but does not exercise a live webview
  (CI has no GUI/display). The harness is run by hand on a real macOS build with `unstable`
  temporarily enabled on the throwaway branch.
- **No production embedding code, no new crates.** The eventual L impl provides the real
  command bodies and any wiring through `tauri::generate_handler!` in `lib.rs`.

---

## 7. Harness status — THROWAWAY / debug-only, do not merge

- Lives only on a `spike/add-child-macos` branch; **never merged** to `master`.
- All three commands are `#[cfg(debug_assertions)]` so they **cannot exist in a release
  build** even if the branch were accidentally merged.
- The accompanying Rust test is an **`#[ignore]` stub** that compiles (std-only, no
  `chromiumoxide`, no live webview) but is opt-in: it requires a real display + the
  `unstable` feature and is run by hand, never in CI.
- The harness builds **no production code** and adds **no crates**.

> **The harness exists to produce the §3 observations and then be deleted.** The deliverable
> of this issue is this document plus the filled-in observation table and the recorded
> GO/NO-GO — not code.

---

## 8. Summary

- **Question:** can Tauri unstable `add_child` host an **external-URL** native child webview
  on **macOS**, track a host `<div>` through window + split resize acceptably, AND — the
  decisive point — render sites that send `X-Frame-Options: DENY` / restrictive
  `frame-ancestors` that an `<iframe>` cannot?
- **Method:** debug-only (`cfg(debug_assertions)`) `preview_spike_open/set_bounds/close`
  driven by a host div + `ResizeObserver` + window-resize + split handle; load a normal site
  and an XFO:DENY site side-by-side against an iframe control.
- **Decision:** §4 rubric. GO only if the child webview renders the frame-blocked site
  (iframe control fails) AND tracks with at most mild jank AND z-order is correct. If the
  native path is *also* frame-blocked, NO-GO — iframe-only wins.
- **Fallback (NO-GO):** iframe for localhost, **system browser via `tauri-plugin-opener`**
  for external URLs; automation requiring the child webview disabled, not crashing.
- **DEFERRED:** Tauri `unstable` feature + real command bodies; harness is debug-only /
  `#[ignore]`, throwaway, no crates.
- Fill §3 on a real macOS build, pick the band, and record the outcome here and in ADR-0001.
