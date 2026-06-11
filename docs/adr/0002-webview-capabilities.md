# ADR 0002 — Webview/screenshot capabilities and CSP hardening

- **Status:** Accepted (config-only; runtime support DEFERRED)
- **Date:** 2026-06-12
- **Issue:** #66
- **Related:** #68 (screenshot acquisition), #138 (size-spike pattern for heavy crates)

## Context

Issue #66 prepares the Tauri v2 desktop shell for an upcoming embedded-webview /
screenshot feature. Two things must change in configuration before any feature
code can run:

1. **Capability manifest** (`src-tauri/capabilities/default.json`) — Tauri v2
   denies every IPC command unless its permission is granted to the window. The
   webview-management and window-geometry commands the feature needs must be
   added to the `permissions` array.
2. **Content-Security-Policy** (`src-tauri/tauri.conf.json` →
   `app.security.csp`) — the repo CSP was recently hardened. #66 wants a variant
   that **explicitly** whitelists BOTH Ollama endpoints in `connect-src` so the
   policy documents the exact hosts the app talks to, rather than relying solely
   on broad `http:`/`https:` fallbacks.

The actual screenshot/embedded-webview runtime (driving an off-screen webview,
capturing pixels) needs the Tauri **`unstable`** feature plus heavy crates
(`chromiumoxide`, `xcap`, `image`) and possibly a bundled Chromium. Per the
project's "no heavy crate additions in this pass" rule, that work is **deferred**
to a dedicated size-spike (mirroring the #138 multi-format I/O approach) and the
#68 acquisition issue.

## Decision

### Capability identifiers to add

Validated against `src-tauri/gen/schemas/desktop-schema.json`. Identifiers that
were requested verbatim but are **not** in the schema have been adjusted to the
closest valid permission, noted inline.

| Requested                              | Valid? | Final identifier used                       |
| -------------------------------------- | ------ | ------------------------------------------- |
| `core:webview:allow-create-webview`    | yes    | `core:webview:allow-create-webview`         |
| `core:webview:allow-set-webview-position` | yes | `core:webview:allow-set-webview-position`   |
| `core:webview:allow-set-webview-size`  | yes    | `core:webview:allow-set-webview-size`       |
| `core:webview:allow-webview-close`     | yes    | `core:webview:allow-webview-close`          |
| `core:window:allow-inner-size`         | yes    | `core:window:allow-inner-size`              |
| `core:window:allow-on-resized`         | **NO** | adjusted → `core:event:allow-listen` (+ `core:window:allow-outer-size`) |

**Adjustment rationale for `on-resized`:** there is no
`core:window:allow-on-resized` command permission in the schema. `on-resized` is
a *window event*, delivered through the event system, so listening for it
requires `core:event:allow-listen` (already implied by `core:default`, but
listed explicitly for clarity). The size-query counterpart is
`core:window:allow-outer-size` (or `core:window:allow-inner-size`, included
above). The capability set therefore becomes:

```
core:webview:allow-create-webview
core:webview:allow-set-webview-position
core:webview:allow-set-webview-size
core:webview:allow-webview-close
core:window:allow-inner-size
core:window:allow-outer-size
core:event:allow-listen
```

These are delivered as a sharedEdit to `capabilities/default.json` (appended to
the existing `permissions` array, after `"dialog:default"`).

### CSP policy

`app.security.csp` is set (sharedEdit) to:

```
default-src 'self'; img-src 'self' data: blob: asset: http://asset.localhost; connect-src 'self' http://localhost:11434 https://cloud.ollama.ai http://localhost:* ws://localhost:* http: https: ws: wss:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; worker-src 'self' blob:; object-src 'none'; base-uri 'self'
```

Notable points:

- `connect-src` now **explicitly** names `http://localhost:11434` (local Ollama)
  and `https://cloud.ollama.ai` (Ollama Cloud) ahead of the broad `http:`/
  `https:` fallbacks, satisfying #66's "include BOTH endpoints" requirement and
  documenting intent.
- `img-src` adds `asset:` / `http://asset.localhost` so captured screenshots and
  Tauri asset-protocol images render.
- `script-src` keeps `https://cdn.jsdelivr.net` (Pyodide, #128) and
  `'wasm-unsafe-eval'`.
- `object-src 'none'` and `base-uri 'self'` retained for hardening.

### Deferred (needs crate / runtime)

The following are **DEFERRED** and must NOT be applied in this pass:

- Enabling the Tauri **`unstable`** feature (required for multi-webview APIs).
- Adding crates `chromiumoxide`, `futures`, `xcap`, `image`.
- The runtime command bodies that create an off-screen webview, drive it, and
  capture/encode pixels.

These land via a follow-up size-spike (#138-style evaluation of build-time and
binary-size impact) and the #68 screenshot-acquisition issue. The Cargo.toml
additions are provided in this issue's `sharedEdits` clearly marked
"DEFERRED — do not apply now" so the orchestrator can stage but not enable them.

## Cloud-vs-local `connect-src` parity gap (noted, not fixed)

The two endpoints in `connect-src` exist because the codebase reaches Ollama at
two different hosts:

- `src-frontend/services/ollama.ts` routes **cloud** models to
  `https://cloud.ollama.ai/api/chat` (see the `isCloudModel` branch at
  `ollama.ts:57`); local calls default to `http://localhost:11434/...`.
- `src-frontend/services/agent.ts` **hardcodes** `http://localhost:11434/api/chat`
  (`agent.ts:30`) and has no cloud-routing branch.

This is a **parity gap**: the agent path cannot currently talk to Ollama Cloud
even though the chat path can. #66 is config-only and deliberately does **not**
fix this — the CSP whitelisting both hosts simply ensures that when the agent
path gains cloud routing, the policy will not block it. Tracking the agent
cloud-routing fix is left to a separate issue.

## Validation

`src-tauri/src/config_validation.rs` parses both config files (relative to
`CARGO_MANIFEST_DIR`) and asserts the invariants above in `#[cfg(test)]`:

- both files parse as JSON;
- the webview/window capability identifiers are present;
- `app.security.csp` is a non-null string whose `connect-src` directive contains
  BOTH `http://localhost:11434` and `https://cloud.ollama.ai` as whole tokens
  (a substring match is rejected so a `http://localhost:*` wildcard cannot
  masquerade as the explicit host).

The file-backed tests describe the TARGET state and pass once the orchestrator
applies this issue's sharedEdits. The pure helper tests
(`connect_src_directive`, `connect_src_has_source`, etc.) pass today.
