# Ollama GUI — Functionality, Feature & Gap Analysis

> Generated 2026-07-08 against branch `macOS-10.15` (HEAD `0709ff0`).
> Baseline: `npx tsc --noEmit` clean; `vitest run` → **1039 passed (90 files)**.

## 1. Functionality analysis

A local-first desktop GUI for [Ollama](https://ollama.com): **Tauri v2** (Rust) +
**React 19** + **TypeScript** + **Tailwind v4**. Everything runs on-device;
optional tools (Chromium, Pandoc, LibreOffice, Poppler) degrade gracefully.

### Architecture
- `src-frontend/` — React UI + service layer (`services/*.ts`) + vitest suites.
- `src-tauri/` — Rust backend; Tauri commands in `lib.rs`, feature modules
  (`browser_engine.rs`, `browser_chromium.rs`, `browser_preview.rs`,
  `document_convert.rs`, `ooxml.rs`, `odf.rs`, `pdf_tools.rs`, `ax.rs`,
  `config_validation.rs`).
- `docs/` — ADRs, spikes, panel contract.
- Single layout shell: `components/PanelShell.tsx` owns the chat-column +
  right-dock + bottom-dock split; every side surface registers into it.

### Functional areas (what actually runs)
- **Chat** — streaming chat with any Ollama model, per-conversation model
  switching, temperature/top-p/top-k/max-tokens, structured (JSON-schema)
  output, prompt library, slash commands, copy-code, streaming cursor.
- **Sessions** — sidebar history (localStorage), new/delete chat (with
  confirmation), pin/archive, folders, message search, export/import JSON,
  temporary chats, conversation branching, message feedback (thumbs),
  cross-session memory, context compaction, checkpoints/rewind.
- **Agentic** — Ollama tool-calling loop with Plan/Ask/Auto autonomy,
  max-iterations guard, PreToolUse guardrails, read-only mode, inline diff
  review, abort propagation. Tools registered: cli/terminal, file read/write,
  git, fetch_url, web_search, browser control, image-diff, documents.
- **MCP** — stdio + HTTP/streamable transports, connector catalog, OAuth/PKCE,
  PAT auth, OS-keychain secrets (encrypted at rest), graceful shutdown,
  auto-reconnect, lifecycle/transport tests.
- **Workspace** — folder picker, file tree, read/write/edit, streaming
  terminal, `@`-mention file context, `#` knowledge injection, Git panel.
- **Knowledge & web** — RAG (hybrid BM25 + vector) over files + named
  collections, web fetch/search, inline citations/sources.
- **AI browser** — CDP-driven Chromium automation (navigate/snapshot AX
  tree/click/type/screenshot/assert) + native preview webview.
- **Documents** — Office + ODF read/create/edit, PDF extract/create/merge/
  split, optional Pandoc/LibreOffice conversion tier, document-artifact panel.
- **More** — image generation, voice (Web Speech + whisper.cpp STT, TTS,
  hands-free call mode), in-app Python (Pyodide), MLX re-check, projects.

### Test surface
90 vitest files / 1039 tests; mirrors the service layer 1:1. UI tests cover
App, PanelShell, BrowserPane, TerminalPanel, FileTreePanel, ArtifactPanel,
WelcomeScreen, feedback, rendering, sendMessage, e2e. No skipped tests; one
`#[ignore]`d Rust harness (needs real Chromium + display).

## 2. Feature analysis

Relative to the OpenAI/Claude-style GUI goals in `implementation_plan.md`, the
implemented feature set is **well beyond** the original plan:

| Plan theme | Planned | Implemented (extra) |
|---|---|---|
| Chat | stream, markdown, code, themes | structured output, prompts, slash cmds, branching, feedback, compaction, checkpoints |
| Sessions | history, new/delete, search, export | pin/archive, folders, temp chat, memory |
| Models | dropdown, pull/remove, endpoint | cloud indicator, remote routing, MLX, model-fit |
| Agentic | tool loop, CLI approval | full tool registry, autonomy levels, diff review |
| MCP | stdio+HTTP, OAuth, mgmt UI | connector catalog, keychain secrets, lifecycle, presets |
| Workspace | files, terminal, git | `@`-mention, `#` knowledge, RAG |
| Browser | (unplanned) | CDP engine + native preview |
| Documents | (unplanned) | Office/ODF/PDF I/O + artifacts |
| Voice | (unplanned) | STT/TTS + hands-free call |

## 3. Gap analysis — plan vs code

`implementation_plan.md` is **stale** and disagrees with the code:

- **Issue #21 (MCP stdio)** — marked `[ ]` (open) in the plan, but git history
  shows `148b105 Complete Issues #21 & #22: MCP stdio and HTTP transports` and
  `2e65100 Complete MCP transport implementations`; `mcp-transport.test.ts`
  and `mcp-tauri.ts`/`mcp-http.ts`/`mcpBridge.ts` exist and pass.
- **Issue #22 (MCP HTTP)** — same: marked open, actually done.
- **Issue #16b (Playwright E2E)** — still genuinely open; a vitest-based
  `e2e.test.tsx` covers core flows in jsdom, but no real-browser E2E exists.

### Gaps found in code (not in plan)
1. **Delete-chat confirmation dialog** — closable only via Cancel/Delete
   buttons. No Escape-to-close, no backdrop-click-to-close (the global Escape
   handler covers Settings/Help only). Minor a11y/UX gap.
2. **Delete-chat confirm path untested** — `App.test.tsx` tests opening the
   dialog and Cancel, but not that confirming *actually removes the session*
   and starts a new chat. Violates AGENTS.md "every feature must have a test".
3. **Scroll-to-bottom button** — appearance/disappearance tested, but the
   click→scroll behavior is untested.
4. **Chromium download** — `browser_chromium_download` Rust body is documented
   DEFERRED ("not yet implemented — locate a system install"). Intentional;
   gracefully degrades to a system-install prompt.
5. **Documentation drift** — `CHANGELOG.md` "[Unreleased]" predates M12–M28.

### Open GitHub issues
The `gh` CLI token is invalid and `api.github.com` is unreachable from this
sandbox (`curl` → HTTP 000), so live open issues could not be fetched. The
repo's last known "fix all open GitHub issues" sweep landed in commit
`18acf6e`; the branches list shows only Dependabot PRs pending. See
`docs/ROADMAP.md` for the locally-registered milestone/issues.
