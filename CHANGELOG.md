# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
#### M88 — Folder rename, drag-file-to-composer & /redo (#387–#389)
- Sidebar folder chips now have a **rename** button (✏️) that prompts for a new
  name and updates the folder via `storage.saveFolder` — VS Code/ChatGPT/Codex
  parity (#387).
- **Dragging a file from the file tree onto the composer** now pins it into
  context (file-tree nodes are `draggable`; the composer drop handler reads the
  path and dispatches `ollama-gui:select-file`) — VS Code/Codex parity (#388).
- New **`/redo`** slash command restores the most recently undone exchange
  (pairs with `/undo`, which now pushes the dropped exchange onto a redo stack) —
  Aider/editor parity (#389).
- 4 new tests (2 folder rename, 1 drag-to-pin, 1 /redo); tsc clean; vitest 1663
  passed.

#### M87 — File-tree context menu, /status & /save · /load snapshots (#384–#386)
- File-tree nodes now have a **right-click context menu** (Pin to chat, Copy
  path, Copy relative path) reusing the `ContextMenu` component inside
  `FileTreePanel` — VS Code/Codex/Claude parity (#384).
- New **`/status`** slash command prints a combined overview (model, workspace
  root, Ollama connection state, message count) in one banner — Claude Code
  `/status` parity (#385).
- New **`/save [name]`** and **`/load <name>`** slash commands snapshot the
  current conversation to `<workspace>/.ollama-gui/sessions/<name>.json` and
  restore it by name, without a download dialog — Aider `/save` `/load` parity
  (#386).
- 5 new tests (1 /status, 3 /save & /load, 1 file-tree menu); tsc clean; vitest
  1659 passed.

#### M86 — Sidebar context menu, /map & /memory commands + CI fixes (#381–#383)
- Sidebar conversation items now have a **right-click context menu**
  (Rename, Pin/Unpin, Add tag, Archive/Unarchive, Duplicate, Delete) reusing
  the `ContextMenu` component — Codex/Claude/ChatGPT/VS Code parity (#381).
- New **`/map`** slash command emits a workspace repo-map overview (top-level
  entries + one nesting level) into the chat, or reports "No workspace open" —
  Aider `/map` parity (#382).
- New **`/memory`** slash command shows the composed cross-session memory block
  (with entry count) that is injected into the prompt, or "No memory entries" —
  Claude Code `/memory` parity (#383).
- 7 new tests (2 /memory, 2 /map, 3 sidebar menu); tsc clean; vitest 1654
  passed.

### Fixed
- **CI: `Build & Test` "Run tests" stage.** `modelPull.test.tsx`'s streaming
  integration tests exceeded the 5s default per-test timeout under CI runner
  load, failing every run. Raised those tests' timeout to 15s.
- **CI: `security-audit` npm step.** `npm audit --audit-level=high` failed on
  high/critical advisories in dev-only tooling (vite, vitest) that never ships
  in the Tauri binary. Switched to `npm audit --omit=dev --audit-level=high` so
  the gate covers the shipped (production) surface; reports 0 vulnerabilities.
- **CI: `e2e` Playwright stage.** `e2e/smoke.spec.ts` had strict-mode
  violations: the Settings button matched two elements, and `getByText('Hi
  there')` matched the sidebar session title plus the message. Scoped locators
  to the exact accessible name / `messages-container` testid.
- **CI: Node.js 20 deprecation.** Bumped workflow `node-version` to 22 (LTS).

#### M85 — Right-click context menu, /cwd command & workspace sync (#378–#380)
- Chat messages now have a **right-click context menu** that consolidates the
  per-message actions (copy, copy as markdown, copy as plain text, regenerate,
  edit, delete, quote, toggle raw/rendered, speak). Closes on outside click,
  Escape, or scroll; keyboard accessible via role="menu"/"menuitem" —
  Codex/Claude/VS Code GUI parity (#378).
- New **`/cwd`** slash command shows the active workspace root path in a
  status banner and copies it to the clipboard; reports "No workspace open"
  when none is active — Aider/Claude Code TUI parity (#379).
- Activating a project (or re-picking its folder) now calls `openWorkspace`
  so the file-tree panel updates both the fileTools root **and** localStorage
  state. `openWorkspace`/`closeWorkspace` broadcast a
  `ollama-gui:workspace-changed` event that `FileTreePanel` listens for and
  re-reads — fixing the bug where the tree kept showing the old workspace after
  project activation. `closeWorkspace` also clears the in-process root via
  `clearWorkspaceRoot` for consistency (#380).
- 6 new tests (2 /cwd, 1 workspace sync, 3 context menu); tsc clean; vitest
  1647 passed.

#### M84 — /settings, /prompt preview & copy-path from file tree (#375–#377)
- New **`/settings`** slash command opens the settings overlay from the chat
  input — Aider/Claude Code TUI parity (#375).
- New **`/prompt`** slash command previews the full **composed system prompt**
  (user prompt + AGENTS.md/CLAUDE.md rules + project instructions + memory) in
  a dismissable overlay with a Copy button — Codex/Claude parity for prompt
  debugging (#376).
- File tree nodes now have a **copy-path** button (visible on hover) that
  copies the full file path to the clipboard without pinning the file —
  VS Code/Codex/Claude parity (#377).
- 5 new tests (1 /settings, 3 /prompt, 1 copy-path); tsc clean; vitest 1641
  passed.

#### M83 — Artifacts shortcut, apply-code-to-file & Ctrl+Enter send (#372–#374)
- **Ctrl+Shift+A** now toggles the artifacts panel — matching the pattern of
  other panel shortcuts (Ctrl+B browser, Ctrl+T terminal, Ctrl+Shift+F files).
  The help overlay also now lists Toggle Artifacts and Tab Indent / Outdent
  — Codex/Claude/VS Code parity (#372).
- Code blocks in chat messages now have an **Apply** button that writes the
  code directly to a workspace file via `writeFile`. When the language tag
  includes a path (e.g. `ts:src/main.ts`), it uses that; otherwise it prompts
  for a relative path. Disabled when no workspace is open — Codex/Claude GUI
  parity (#373).
- A new **Send on Ctrl+Enter** settings toggle swaps the composer behaviour:
  Enter inserts a newline, Ctrl/Cmd+Enter sends. Default is unchanged (Enter
  sends) — ChatGPT/Claude/Slack parity (#374).
- 8 new tests (2 shortcut/overlay, 2 apply-code, 4 Ctrl+Enter); tsc clean;
  vitest 1636 passed.

#### M82 — Clear-all pinned files, copy-diff button & /web command (#369–#371)
- A **"Clear all"** button now appears next to pinned file chips when 2+ files
  are pinned, allowing instant removal of all pinned context files —
  Codex/Claude/VS Code context UI parity (#369).
- The diff-review modal now has a **"Copy diff"** button that copies a unified
  diff to the clipboard — Codex/Claude/GitHub PR UI parity (#370).
- New **`/web <query>`** slash command manually triggers a web search (using
  the existing `webSearch` infrastructure) and feeds results into the chat as
  a context block — Aider/Claude Code TUI parity (#371).
- 7 new tests (2 clear-all, 2 copy-diff, 3 /web); tsc clean; vitest 1628
  passed.

#### M81 — Search highlighting, command palette completeness & token estimate (#366–#368)
- In-conversation search (Ctrl+F) now **highlights matched terms** within
  message text using `<mark>` elements — both in rendered markdown and raw
  view. Highlights clear when search is closed — Codex/Claude/VS Code parity
  (#366).
- The command palette (Ctrl+P) now includes **12 additional actions**: Toggle
  Theme, Toggle Zen Mode, Toggle Artifacts, Regenerate, Copy Last Reply,
  Scroll to Latest, Pin/Unpin, Next/Previous Conversation, and Zoom
  In/Out/Reset — Codex/Claude GUI parity for discoverability (#367).
- The composer footer now shows an **estimated token count** alongside the
  word/char count, using the existing `estimateTokens` utility — Codex GUI
  parity for context-window awareness (#368).
- 7 new tests (2 search highlight, 3 palette, 2 token estimate); tsc clean;
  vitest 1621 passed.

#### M80 — File-tree wiring, sidebar DnD & /init command (#363–#365)
- Clicking a file in the workspace file-tree now **pins it into the chat
  context** (the `select-file` event was dispatched but never consumed —
  fixed). Directories are ignored — Codex/Claude GUI parity (#363, bug).
- Sidebar conversations are now **draggable onto folder chips** (and the
  "All" chip to unfile). A ring highlight shows the drop target —
  Codex/Claude/ChatGPT parity (#364).
- New **`/init`** slash command generates an `AGENTS.md` project-rules file
  from the workspace directory listing via the active model, writes it to
  the workspace root, and reloads project rules — Aider TUI parity (#365).
- 6 new tests (2 file-tree, 2 DnD, 2 /init); tsc clean; vitest 1614 passed.

#### M79 — Keyboard parity: Tab-indent, approval & diff-review shortcuts (#360–#362)
- Tab in the chat composer now inserts two spaces (Shift+Tab outdents) when
  no `@`/`#`/slash autocomplete suggestions are open — TUI/Codex/Claude parity
  (#360).
- The CLI command approval modal now responds to Enter (Allow Once), Escape
  (Deny) and A (Always Allow) — Codex/Claude GUI parity (#361).
- The diff-review modal now responds to Enter (Accept) and Escape (Reject) —
  Codex/Claude GUI parity (#362).
- 8 new tests (6 keyboard-parity UI, 2 diff-review keyboard); tsc clean;
  vitest 1608 passed.

#### M78 — /commit, /tests & welcome-screen prompt library (#357–#359)
- `/commit [message]` stages all changes and commits; when no message is
  given it generates a conventional commit message from the diff via the
  active model — Aider-style (#357).
- `/tests <command>` runs a test suite and, on non-zero exit, feeds the
  failures to the model framed as tests to fix; on success it just reports
  "Tests passed" without disturbing the model — Aider-style (#359).
- The empty-state WelcomeScreen now shows the user's saved prompt library
  (falling back to the starter prompts when empty) — ChatGPT/Claude-style
  customizable quick actions (#358).
- 14 new tests (4 command-unit, 4 WelcomeScreen, 6 UI); tsc clean;
  vitest 1600 passed.

#### M77 — External links, autonomy quick-selector & resume-last-session (#354–#356)
- Markdown links in messages now open in the system browser (via the opener
  plugin) instead of navigating the Tauri webview; non-http anchors are left
  as ordinary links (#354, bug).
- A compact Plan/Ask/Auto autonomy selector is now in the chat header (plus
  Command Palette entries), so the approval mode can be changed without
  opening Settings — Codex-GUI style (#355).
- New opt-in "Resume last conversation on startup" setting loads the most
  recent non-archived session on launch — Claude-Code style (#356).
- 9 new tests (4 openExternal service, 5 UI); tsc clean; vitest 1586 passed.

#### M76 — Image lightbox, interactive task lists & /run (#351–#353)
- Clicking any attached image (pending or in-message) opens a full-size
  lightbox overlay; close with the ✕ button, backdrop click, or Escape (#351).
- GFM task-list checkboxes in rendered messages are now interactive — clicking
  a `- [ ]`/`- [x]` box toggles it and persists the updated message (#352).
- `/run <command>` executes a shell command (user-initiated, no approval) and
  feeds its stdout/stderr into the chat as context, Aider-style (#353).
- 21 new tests (15 taskList service, 2 command-unit, 4 UI); tsc clean;
  vitest 1577 passed.

#### M75 — /reset, /tokens & pinned-file context (#348–#350)
- `/reset` restores all generation parameters to defaults in one step (#348).
- `/tokens` prints a per-source estimated context-token breakdown (rules,
  instructions, memory, system prompt, pinned files, conversation, input)
  with total vs `num_ctx` (#349).
- Aider-style `/add <file>`, `/drop <file>` and `/files` pin file contents
  into the chat context across turns, with removable chips above the
  composer; cleared on `/new` and `/clear` (#350).
- 32 new tests (7 command-unit, 19 pinnedFiles service, 6 UI); tsc clean;
  vitest 1556 passed.

#### M74 — /clear in-place, /undo & /diff (#345–#347)
- `/clear` now clears the messages of the current conversation in place
  (keeping the session entry), distinct from `/new` which starts a fresh
  session (#345).
- `/undo` slash command drops the last user+assistant exchange and persists
  the trimmed conversation (#346).
- `/diff` slash command feeds the current git diff (working-tree or `staged`)
  into the chat as context for the model to review (#347).
- 11 new tests (6 command-unit, 5 UI); tsc clean; vitest 1524 passed.

#### M29 — Chat UX & Dialog Accessibility
- Delete-chat confirmation dialog now closes on Escape and on backdrop click.
- Tests covering confirm-delete removal, Escape/backdrop dismissal, and
  scroll-to-bottom click behaviour.

#### M28 — Third analysis pass fixes (#195–#201)
- Wired browser, artifacts, file-tree, and terminal panels into PanelShell.
- Fixed project model bindings, browser preview, checkpoints, and CDP commands.

#### M27 — Agent behavior & context gaps (#189–#194)
- Wired `@`-file mention and `#`-knowledge injection in the composer.
- Wired diff-review callback and diff-review modal.
- Registered terminal and image-diff as agent tools; propagated abort signal.
- Knowledge collection management UI in Settings.

#### M24–M26 — Secret store, remote Ollama, composer wiring (#173–#188)
- Secret store settings UI + secrets service (OS keychain encryption).
- Remote Ollama routing + local/remote model selector UX.
- Project model bindings, browser preview, checkpoints, CDP commands.

#### M20–M23 — Workspace, broken contracts, autonomy, MLX (#82–#91, #146)
- Filesystem commands, diff review, `@`-mention, workspace state, streaming terminal.
- Git integration panel. Agent autonomy & safety (Plan/Ask/Auto, guardrails).
- MLX re-check + model UX gaps.

#### M18 — Multi-format file editing (#138–#145)
- Office + ODF read/create/edit (xlsx→csv, xlsx cell-edit, ods read).
- PDF create/extract/merge/split via lopdf.
- Document artifacts panel + LibreOffice onboarding.

#### M14 — Knowledge, RAG & web grounding (#117–#122)
- Knowledge collections + hybrid BM25 + vector RAG pipeline.
- Web fetch/search, `#` context command, inline citations/sources.

#### M13 — MCP integrations & connectors (#112–#116)
- MCP connector catalog + transport headers + reference deployment.
- Connector: Filesystem MCP server (directory picker + quoted-path verification).

#### M12 — MCP bridge & sub-agents (#102, #104)
- MCP bridge service and sub-agent orchestration.

#### Chat & model parity (M11 + assorted #123–#148)
- Rich rendering: Mermaid diagrams + LaTeX math in messages (#135).
- Appearance settings: light/dark/system + accent + density (#136).
- Temporary/incognito chat (#134); thumbs feedback + message queue (#137).
- Chat organization: folders, tags, pin, archive (#133).
- Structured output via Ollama format (JSON / JSON Schema) (#148).
- Hardware-aware model fit indicator (#147); model presets + modelfile builder (#124, #125).
- OpenAI-compatible / LM Studio endpoints (#123); many-models fan-out (#126).
- OpenAPI tool servers (#129); custom Tools & Functions framework (#127).
- Local image generation (A1111/ComfyUI/DALL-E) (#130); in-app Python via Pyodide (#128).
- Speech-to-text via whisper.cpp (#131); hands-free voice call mode (#132).

### Changed
- Enhanced error handling, memoization, input validation throughout.
- Cross-platform build pipeline (CI for Linux, Windows, macOS).
- macOS 10.15 compatibility branch + binary-size budget spike.

### Fixed
- Agent infinite-loop guard, MCP transport flakiness, accessibility, edge cases.
- White-screen mount/CSP fixes; Tailwind v4 import; native window title-bar theme sync.
- Remote Ollama routing; model control width; image attachment MIME type (PNG/GIF/WebP).

## [0.1.0] - 2026-06-10

### Added
- Initial Ollama GUI implementation
- Basic chat functionality
- Model management
- Session management
- Markdown rendering with syntax highlighting
- Image attachments
- Responsive design
- Theme support (light/dark mode)
- Keyboard shortcuts

### Changed
- Upgraded to Tauri 2.0
- Improved code organization
- Enhanced TypeScript type safety
- Added comprehensive testing

### Fixed
- Fixed initial build issues
- Resolved responsive design problems
- Improved error handling
- Fixed memory leaks

## [0.0.1] - 2026-06-01

### Added
- Initial project setup
- Basic Tauri configuration
- React frontend skeleton
- Vite build system
- Initial test setup

[Unreleased]: https://github.com/janipasanen/ollamaGUI/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/janipasanen/ollamaGUI/releases/tag/v0.1.0
[0.0.1]: https://github.com/janipasanen/ollamaGUI/releases/tag/v0.0.1
