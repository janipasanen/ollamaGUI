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
  prompt library, slash commands, and a many-models mode to send one prompt to several
  models side by side.
- **Agentic tools** — a tool-calling loop with Plan / Ask / Auto autonomy levels,
  configurable max iterations, PreToolUse guardrails, read-only tool mode, inline diff
  review, checkpoints/rewind, sub-agent orchestration (spawn isolated or parallel
  sub-agents, plus a cloud-brain/local-worker delegation mode), a custom tools/functions
  framework for user-defined actions, and in-app Python execution via Pyodide.
- **MCP** — connect Model Context Protocol servers (stdio + HTTP), a connector catalog,
  OAuth/PAT auth with secrets in the OS keychain, graceful shutdown, auto-reconnect, and
  turning any OpenAPI 3.x spec into agent tools automatically.
- **Workspace** — folder picker + file tree, read/write/edit files, an integrated
  streaming terminal, `@`-mention file context, a Git panel (status/diff/stage/commit),
  and a workspace-wide code search panel.
- **Knowledge & web** — RAG over local files and named knowledge collections (hybrid
  BM25 + vector search), web fetch/search, the `#` context command, and inline citations.
- **AI browser** — a CDP-driven Chromium automation engine (navigate / snapshot the
  accessibility tree / click / type / screenshot / assert) plus a native preview pane, a
  scenario recorder/replayer, and visual pixel-diff assertions between screenshots.
- **Documents** — read/create/edit Office + ODF formats and PDFs (extract / create /
  merge / split), with an optional Pandoc/LibreOffice conversion tier.
- **More** — image generation, voice (dictation, TTS, hands-free call mode), projects,
  cross-session memory, conversation branching, an artifacts/canvas panel, and an
  MLX acceleration tier for local inference on Apple Silicon.

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

## Building & installing the app

One command builds the production app **and** the platform installers
(`bundle.targets` is `"all"` in `src-tauri/tauri.conf.json`):

```bash
npm install          # once
npm run tauri build
```

The first build compiles the whole Rust backend in release mode and takes a while;
afterwards everything lands under `src-tauri/target/release/`:

| Platform | Artifacts (under `src-tauri/target/release/bundle/`) | Install |
|----------|------------------------------------------------------|---------|
| **macOS** | `macos/ollama-gui.app`, `dmg/ollama-gui_0.1.0_<arch>.dmg` | Open the `.dmg` and drag **ollama-gui.app** to `/Applications` (or copy the `.app` there directly) |
| **Windows** | `msi/ollama-gui_0.1.0_x64_en-US.msi`, `nsis/ollama-gui_0.1.0_x64-setup.exe` | Run either installer; it registers Start-menu shortcuts and an uninstaller |
| **Linux** | `deb/ollama-gui_0.1.0_amd64.deb`, `rpm/ollama-gui-0.1.0-1.x86_64.rpm`, `appimage/ollama-gui_0.1.0_amd64.AppImage` | `sudo dpkg -i <file>.deb` / `sudo rpm -i <file>.rpm`, or `chmod +x` the AppImage and run it anywhere |

Platform notes:

- **Cross-compiling is not supported** — build on the OS you are targeting
  (CI builds all three; see `.github/workflows/build.yml`).
- **macOS**: the app is unsigned by default, so the first launch needs
  right-click → *Open* (or `xattr -cr /Applications/ollama-gui.app`) to pass
  Gatekeeper. To target a specific architecture use
  `npm run tauri build -- --target aarch64-apple-darwin` (Apple Silicon) or
  `x86_64-apple-darwin` (Intel); with both Rust targets installed,
  `--target universal-apple-darwin` produces one binary that runs on both.
- **Windows**: end users need the WebView2 runtime (preinstalled on Windows 11;
  the installer bootstraps it on Windows 10 if missing).
- **Linux**: the `.deb`/`.rpm` declare the WebKitGTK dependencies for you; the
  AppImage bundles most of them. On the build machine install the
  [Tauri v2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux)
  first (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, …).

### Standalone binary

Yes — Tauri compiles the entire frontend (`dist/`) **into** the executable, so the
bare release binary is fully standalone (no separate asset folder needed):

```bash
# build just the executable, skipping all installer packaging
npm run tauri build -- --no-bundle
```

The binary is at `src-tauri/target/release/ollama-gui`
(`ollama-gui.exe` on Windows). You can copy it to any machine of the same OS and
architecture and run it directly — the only external requirement is the
platform's webview runtime (WebKit ships with macOS, WebView2 with Windows 11,
`webkit2gtk-4.1` from your distro's packages on Linux) plus a running Ollama.
Optional engines (Chromium, Pandoc, LibreOffice, Poppler) are looked up at
runtime, never bundled.

## Testing

```bash
# frontend unit/integration tests (vitest)
npm test
npm run test:watch          # watch mode

# Rust backend tests (browser/document/AX logic, etc.)
cargo test --manifest-path src-tauri/Cargo.toml

# browser E2E (Playwright, #16b) — drives the Vite dev server with a real
# Chromium; install the browser once, then run:
npx playwright install chromium
npm run test:e2e
```

A few Rust integration tests are marked `#[ignore]` because they need a real Chromium
install + a display; run them explicitly on a capable machine, e.g.
`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored`.

CI (`.github/workflows/build.yml`) runs type-check, the vitest suite, the frontend +
Tauri builds, a dependency security audit across Ubuntu / Windows / macOS, and a
Playwright browser E2E job on Ubuntu.

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
