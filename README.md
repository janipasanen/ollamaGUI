# Ollama GUI

A local-first desktop GUI for [Ollama](https://ollama.com), built with **Tauri v2**,
**React 19**, **TypeScript**, and **Tailwind**. Chat with local models, run an agentic
tool loop, connect MCP servers, edit files and run commands in a workspace, browse and
test the web, ground answers in your own documents, and work with multi-format files —
all running on your machine.

> Status: active development (v0.1.0). The frontend is in `src-frontend/`, the Rust
> backend in `src-tauri/`, and architecture/decision notes in `docs/`.

## Features

- **Chat** — streaming chat with any Ollama model; per-conversation model switching,
  temperature / top-p / top-k / max-tokens controls, structured (JSON-schema) output,
  prompt library, and slash commands.
- **Agentic tools** — a tool-calling loop with Plan / Ask / Auto autonomy levels,
  configurable max iterations, PreToolUse guardrails, read-only tool mode, inline diff
  review, and checkpoints/rewind.
- **MCP** — connect Model Context Protocol servers (stdio + HTTP), a connector catalog,
  OAuth/PAT auth with secrets in the OS keychain, graceful shutdown, and auto-reconnect.
- **Workspace** — folder picker + file tree, read/write/edit files, an integrated
  streaming terminal, `@`-mention file context, and a Git panel (status/diff/stage/commit).
- **Knowledge & web** — RAG over local files and named knowledge collections (hybrid
  BM25 + vector search), web fetch/search, the `#` context command, and inline citations.
- **AI browser** — a CDP-driven Chromium automation engine (navigate / snapshot the
  accessibility tree / click / type / screenshot / assert) plus a native preview pane.
- **Documents** — read/create/edit Office + ODF formats and PDFs (extract / create /
  merge / split), with an optional Pandoc/LibreOffice conversion tier.
- **More** — image generation, voice (dictation, TTS, hands-free call mode), projects,
  cross-session memory, conversation branching, and an artifacts/canvas panel.

## Prerequisites

**Required**

- [Node.js](https://nodejs.org) 20+ and npm
- [Rust](https://www.rust-lang.org/tools/install) (stable) — for the Tauri backend
- Tauri's OS build dependencies — see the
  [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform
  (Xcode CLT on macOS; WebView2 on Windows; `webkit2gtk` etc. on Linux)
- [Ollama](https://ollama.com/download) running locally (default `http://localhost:11434`),
  with at least one model pulled, e.g. `ollama pull llama3`

**Optional** (features degrade gracefully when absent)

| Tool | Enables |
|------|---------|
| A Chrome/Chromium install | the AI browser automation engine (or use the in-app consented download) |
| [Pandoc](https://pandoc.org) | document conversion (md ↔ docx ↔ odt ↔ html) |
| [LibreOffice](https://www.libreoffice.org) | high-fidelity conversion + pptx/odp/PDF export |
| [Poppler](https://poppler.freedesktop.org) (`pdftotext`, `pdfinfo`) | richer PDF text/info (bundled lopdf is used otherwise) |

## Getting started

```bash
# 1. install dependencies
npm install

# 2. run the desktop app in development (hot-reloading frontend + Rust backend)
npm run tauri dev
```

The first `tauri dev` compiles the Rust backend, so it takes a few minutes; subsequent
runs are fast. Make sure Ollama is running first.

### Other commands

| Task | Command |
|------|---------|
| Desktop app (dev) | `npm run tauri dev` |
| Frontend only, in a browser at `http://localhost:5173` | `npm run dev` |
| Build the distributable desktop app (`.app` / `.dmg` / `.msi` / …) | `npm run tauri build` |
| Build the frontend bundle only | `npm run build` |
| Type-check | `npx tsc --noEmit` |

> Running `npm run dev` (browser-only) loads the UI but Tauri-backed features
> (filesystem, terminal, git, documents, native browser preview, OS keychain) are
> unavailable — use `npm run tauri dev` for the full app.

## Testing

```bash
# frontend unit/integration tests (vitest)
npm test
npm run test:watch          # watch mode

# Rust backend tests (browser/document/AX logic, etc.)
cargo test --manifest-path src-tauri/Cargo.toml
```

A few Rust integration tests are marked `#[ignore]` because they need a real Chromium
install + a display; run them explicitly on a capable machine, e.g.
`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored`.

CI (`.github/workflows/build.yml`) runs type-check, the test suite, the frontend +
Tauri builds, and a dependency security audit across Ubuntu / Windows / macOS.

## Project layout

```
src-frontend/        React + TypeScript UI
  components/         shared components (PanelShell, BrowserPane, …)
  services/          app logic (ollama, mcp, tools, rag, documents, browser, …)
  test/              vitest suites
src-tauri/           Rust backend
  src/lib.rs         Tauri commands + app setup
  src/*.rs           feature modules (document_convert, ooxml, ax, browser_engine, …)
  capabilities/      Tauri capability/permission manifest
  tauri.conf.json    app config + CSP
docs/
  adr/               architecture decision records
  spikes/            spike notes (binary-size budget, AX-tree gate, add_child webview)
```

## Configuration notes

- **Ollama endpoint** — set in the app's Settings (defaults to `http://localhost:11434`);
  cloud models route to `https://cloud.ollama.ai`. Both are whitelisted in the app CSP.
- **Secrets** (OAuth tokens, MCP credentials) are stored in the OS keychain
  (Keychain / Credential Manager / Secret Service), with an encrypted-file fallback.
- **Optional engines** (LibreOffice, Chromium) are detected at runtime and never bundled;
  the app prompts to locate or download them the first time a feature needs one.
