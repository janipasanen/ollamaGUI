# ADR-0001: Built-in browser (preview + agent automation)

- **Status:** Accepted (foundation; spike gates open — see #67, #69)
- **Date:** 2026-06-11
- **Issue:** #65 (foundation), with downstream #66–#69
- **Deciders:** ollamaGUI maintainers

## Context

ollamaGUI needs a built-in browser surface that serves two distinct audiences:

1. **A human preview pane** — letting the user view the local dev app and
   external pages without leaving the desktop app.
2. **An agent automation target** — letting a local model drive a real browser:
   navigate, read the page, click, type, and assert on the result.

These two needs pull in different directions. A preview wants the cheapest,
most CSP-friendly embed; automation wants a controllable engine with a stable
page model and visual ground truth. This ADR records how we reconcile them and,
critically, which load-bearing decisions are still **open risks** gated behind
spikes.

## Decision

### Rendering / embedding

- **External URLs render in a native child webview.** We embed external origins
  via Tauri's **unstable `add_child`** webview API (a separate top-level
  navigation hosted inside the app window). This gives real navigation, cookies,
  and a genuine browser engine rather than an iframe sandbox.
- **Localhost / dev URLs render in an `<iframe>`.** The local dev surface
  (default `http://localhost:5173`, plus `localhost`/`127.0.0.1`/`[::1]`/`0.0.0.0`
  on any port) is same-trust and iframe-friendly, so it uses the lighter iframe
  path. Routing between the two is decided by `isLocalhostUrl()` in
  `src-frontend/services/browser.ts`.

  > **Security note — CSP boundary:** the embedded **native child webview is a
  > separate top-level navigation and is NOT governed by the app's Content
  > Security Policy.** The app CSP constrains the React UI document only; it does
  > **not** sandbox or restrict what the child webview loads or executes. All
  > containment for external content therefore comes from the guardrail layer
  > (below) and from the OS webview, not from CSP. This must be stated loudly in
  > any security review of the feature.

### Automation engine

- **CDP/Chromium via `chromiumoxide`.** Agent automation drives a Chromium
  instance over the Chrome DevTools Protocol using the `chromiumoxide` crate.
  This is what makes click/type/navigate/screenshot reliable and scriptable.
- **AX-tree `ref=eNN` page model.** The agent's view of a page is an
  **accessibility-tree snapshot**: each actionable node gets a stable `eNN` ref
  (mirrored in `BrowserState.lastSnapshotRefs`). The model targets actions by
  ref, not by brittle CSS/XPath. Refs flagged `isSecret` (password/sensitive
  inputs) are redacted and write-gated.
- **Screenshots for visual asserts.** Alongside the AX tree we capture
  screenshots so the model (and the user) can make visual assertions the AX tree
  can't express (layout, rendering, canvas/image content).

### Guardrails

- **Reuse the existing CLI approval + allowlist machinery.** Browser actions are
  gated through the same `registerCliTool` approval pattern and host allowlist
  already used for CLI tools (see `services/cli-tool.ts` and
  `services/browserApproval.ts`). We do **not** invent a parallel approval
  system: navigation to non-allowlisted hosts and any write/`eval` action
  require explicit user approval, and every gated action emits an `audit` event
  on `browserBus`.

### State & events foundation (this issue, #65)

- `src-frontend/services/browser.ts` owns the canonical, pure, in-memory
  `BrowserState` (`currentUrl`, `navUrl`, `isPreviewOpen`, `mode`,
  `engineConnected`, `lastSnapshotRefs`), a `browserSession` singleton with typed
  setters, and a `browserBus` emitter (`Map<event, Set<cb>>`, mirroring the
  `McpStdioClient` listener pattern). It is deliberately free of Tauri/IPC so it
  is unit-testable under vitest/jsdom and provides stable symbols for downstream
  workers to import.

## Open-risk decisions (spike gates)

These three decisions are **not yet settled** and each gates a heavier piece of
work. They are called out explicitly so reviewers and downstream issues treat
them as risks, not done deals.

### (a) Chromium acquisition strategy — DEFERRED to #68

We have not decided **how the Chromium binary gets onto the user's machine**.
The candidates each have real downsides:

- **Bundle** Chromium with the app — large download, licensing/update burden,
  per-platform packaging.
- **Fetch** Chromium on first use — network dependency, integrity/version
  pinning, failure modes on offline/locked-down machines.
- **System-detect** an existing Chrome/Chromium — zero download, but fragile
  discovery and unpredictable versions/flags.

**Decision deferred to #68.** Until then, the engine layer must degrade
gracefully when no Chromium is present (preview/iframe still works; automation
is disabled), following the optional-runtime detection pattern of
`check_mlx_available`.

### (b) AX-tree vs vision reliability — ASSUMPTION, gated by spike #67

We **assume** the AX-tree `ref=eNN` model is reliable enough to be the primary
action-targeting mechanism, with screenshots as a visual-assert supplement. This
is an **unvalidated assumption**: on real-world pages the AX tree can be sparse,
mislabeled, or out of sync with what a local vision model "sees."

**This assumption must clear a local-model spike gate (#67) before the XL
automation engine is built.** If the spike shows AX-tree targeting is
insufficient with the local models we ship, the engine design must shift toward
vision-driven targeting. **Do not build the XL engine before #67 resolves this.**

### (c) Native `add_child` is unstable + platform-fragile — spike #69 precedes the L impl

The external-URL path depends on Tauri's **unstable `add_child` webview API**,
which is API-unstable and **platform-fragile** (windowing/embedding behavior
differs across macOS/Windows/Linux and across Tauri/webview versions).

- **Documented fallback: iframe-only.** If `add_child` is unavailable or broken
  on a platform, the browser degrades to the **iframe-only** path
  (`mode: 'iframe'`). External automation/preview features that strictly need the
  child webview are disabled there rather than crashing.
- **Spike #69 precedes the L implementation.** The child-webview integration
  must be de-risked by spike #69 before the large (L) implementation lands. **Do
  not build the L child-webview impl before #69 resolves.**

## Consequences

- The foundation (#65) is pure and testable today; nothing downstream is blocked
  on Tauri wiring to consume `browserSession`/`browserBus`.
- Two render paths (iframe vs child webview) mean two trust models; the CSP gap
  on the child webview makes the guardrail/allowlist layer load-bearing for
  security, not a nice-to-have.
- Three explicit spike gates (#67, #68, #69) keep us from over-committing to
  Chromium packaging, AX-tree targeting, or unstable `add_child` before each is
  validated.

---

## Spike findings (#67 — AX-tree vs vision)

> _To be appended when spike #67 completes. Record: which local models were
> tested, AX-tree coverage/accuracy observed, vision fallback results, and the
> go/no-go decision for the XL engine targeting strategy._

_(pending)_

---

## Spike findings (#69 — native `add_child` child webview)

> _To be appended when spike #69 completes. Record: per-platform
> (macOS/Windows/Linux) behavior of `add_child`, Tauri version pinning, observed
> breakage/quirks, and the go/no-go decision for the L child-webview
> implementation vs. staying iframe-only._

_(pending)_
