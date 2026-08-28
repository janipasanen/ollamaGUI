# Roadmap — Milestones & Issues (M29+)

> Registered on GitHub. M1–M28 already existed (closed); M29 and M30 created
> here. Baseline: branch `macOS-10.15`, HEAD `0709ff0`, vitest 1043 passing.
> See `docs/ANALYSIS.md` for the functionality/feature/gap analysis.

## Milestone 29 — Chat UX & Dialog Accessibility  ✅ done (closed on GitHub)
Small, test-backed refinements to the two most recent UI additions (delete-chat
confirmation `6b43872`, scroll-to-bottom `c473ae5`).

- [x] **#210** Delete-chat confirmation: close on Escape and on backdrop click.
- [x] **#211** Test that confirming deletion actually removes the session (AGENTS.md regression coverage).
- [x] **#204→#212** Test that clicking the scroll-to-bottom button scrolls to the bottom and hides the button.

 **Status:** complete. `tsc --noEmit` clean; vitest 1043 passed (+4 new).
 Verified: Escape + backdrop close the dialog; confirming removes the
 session; the scroll-to-bottom button calls `scrollIntoView` and hides.

## Milestone 30 — Deferred & Cross-cutting
- [x] **#213** Chromium download — the Rust `browser_chromium_download` (reqwest
  stream + zip + `chromium://progress` events) was already implemented; added the
  frontend `onProgress` listener + tests, and de-stale'd the "DEFERRED" docs.
- [x] **#214** Playwright E2E — `playwright.config.ts` + `e2e/smoke.spec.ts`
  (3 tests, mocked Ollama API), `npm run test:e2e`, `tsconfig.e2e.json`, CI `e2e`
  job on Ubuntu, README + `.gitignore` updates. Runs on CI; not on the macOS 10.15
  host (Playwright has no Chromium build for 10.15).
- [x] **#215** CHANGELOG `[Unreleased]` refreshed to cover M12–M28.
- [ ] **#216** Merge `macOS-10.15` → `master`. Merge is conflict-free (verified
  via `git merge --no-commit`); local checks green (tsc, vitest 1045, cargo 87).
  Remaining: commit the M29/M30 work, push, watch CI go green, then merge and
  reconcile Dependabot bumps (lopdf, quick-xml, reqwest, tauri, zip, …). This
  step needs explicit commit/merge authorization.

## Notes
- M1–M28 are complete per git history; `implementation_plan.md` has been
  reconciled (Issues #21/#22 now marked done).
- No tests are skipped; one `#[ignore]`d Rust harness needs real Chromium.
- GitHub issue numbers in titles (#202–#207) were planning placeholders; the
  real GitHub issue numbers are #210–#216 (issue numbering is global and was at
  #201 before this work).


## Milestone 31 — Unwired-feature wiring pass
- [x] **#223** Remove the dead `cli-tool.ts` duplicate (`CliToolWrapper`). The
  production CLI tool is `run_shell_command` (tools.ts, Rust `run_cli`);
  `CliToolWrapper` was a parallel `run_cli_command`/Rust `run_cli_command` path
  used only as a test fixture. Deleted `services/cli-tool.ts` + `test/cli-fix.test.ts`,
  and migrated the `agentic.test.ts` / `setup.ts` / `e2e.test.tsx` fixtures to an
  inline registry stub. tsc clean; vitest 1065 (90 files).
- [x] **#222** Wire `document_edit` (OOXML surgical + template fill) and
  `document_odf_edit` (ODF surgical) as agent tools. These Rust commands were
  implemented + tested but had no frontend caller (dead backend, found in the
  #221 contract audit). Added `editDocument` / `templateFillDocument` /
  `editOdfDocument` wrappers in documents.ts and registered
  `document_edit` / `document_template_fill` / `document_odf_edit` tools. 4 new
  documentTools tests; tsc clean; vitest 1080.
- [x] **#221** Fix `browser_assert` AX-tree contract bug (same class as #219).
  The Rust `browser_cdp_get_ax_tree` returns a string outline, but `browser_assert`
  read `tree.refs`/`tree.text` (always undefined for a string) → `text_present` and
  `element_exists` were always false. Routed it through the `normalizeAxTree` helper.
  Also audited the full Rust↔frontend command surface (63 FE-invoked commands);
  arg camelCase↔snake_case maps via Tauri, and the only dead Rust commands are
  `document_edit`/`document_odf_edit` (no FE caller — candidate for a future tool).
  6 new browser_assert tests; tsc clean; vitest 1076.
- [x] **#220** Wire `browserPreview.ts` into BrowserPane (remove inline IPC
  duplication). browserPreview had no test seam and no tests, and BrowserPane
  re-implemented the `preview_webview_*` calls inline. Added a `_mocks.invoke`
  seam + `_resetPreviewState` + optimistic `_open` to browserPreview, a new
  11-test `browserPreview.test.ts`, and delegated BrowserPane's
  open/close/set_bounds/reload to it (dropping BrowserPane's own tauriInvoke
  seam). 3 BrowserPane preview tests migrated to the new seam; tsc clean;
  vitest 1070.
- [x] **#219** Wire browserSnapshot into browser_snapshot/browser_wait_for +
  fix the AX-tree contract bug. The Rust `browser_cdp_get_ax_tree` returns a
  **string outline**, but `browser_wait_for` read `tree.refs`/`tree.text` (always
  undefined) and `browser_snapshot` never populated `browserSession.lastSnapshotRefs`
  — so `browser_type` secret-field detection was always false (password-echo risk).
  Added a `normalizeAxTree` helper (handles string + structured shapes); snapshot
  now publishes refs via `updateSessionSnapshot`; wait_for matches against the
  outline. 6 new browser-tools tests; tsc clean; vitest 1059.
- [x] **#218** Register the PDF tools (pdf_info/merge/split/extract/create) as
  agent tools — `documentsPdf.ts` was implemented + tested but unreachable from
  the UI/agent. Wired into `registerDocumentTools`; de-stale'd the "DEFERRED"
  docs. 3 new documentTools tests; tsc clean; vitest 1053.
- [x] **#217** Wire the Chromium consent/download prompt into `BrowserPane` —
  `browserChromium.ts` was implemented + tested but imported by nothing. Added a
  non-blocking consent banner (status probe on mount, Download Chromium with
  `onProgress` + Recheck + error surfacing; skipped in browser mode). 5 new
  BrowserPane tests; tsc clean; vitest 1050.

---

## M32 — Test coverage & hardening (fourth analysis pass)

Context: a fresh feature + gap analysis run after M31. The repo is mature
(vitest 1065, cargo 87). Remaining gaps are narrow coverage holes + one dead
scaffold + an incomplete help overlay. **No merge to `master`** — work stays
on `macOS-10.15`.

- [x] **#224** Add Ollama API error-handling, timeout & abort-signal tests.
  `ollama.ts` already throws on non-`ok` and accepts `AbortSignal`, but
  `ollama.test.ts` has no error/timeout/abort cases. AGENTS.md explicitly
  requires Ollama error-handling + timeout tests.
- [x] **#225** Add unit tests for the secrets keychain wrapper
  (`secret_set/get/delete/listRefs`). Security-sensitive, used by `App.tsx`,
  currently untested (`secretStore.ts` is a different, already-tested module).
- [x] **#226** Add unit tests for `orchestrator.ts` `runCloudBrainLocalWorker`
  (brain-plan / worker / brain-final). Imported by `App.tsx` + `mlx.ts`, no
  test file, not imported by any existing test.
- [x] **#227** Remove the dead Tauri `greet` template stub
  (`lib.rs:227` + its `generate_handler!` entry). Not invoked anywhere in the
  frontend — leftover `cargo tauri init` scaffold.
- [x] **#228** Complete the keyboard-shortcuts help overlay. `Ctrl+B` / `Ctrl+F`
  / `Ctrl+T` are implemented in the `keydown` handler but missing from the `?`
  overlay.

### Notes from this analysis pass
- Confirmed **not** gaps (already covered, possibly under a differently-named
  test file): `systemPrompt` (tested in `projects.test.ts` via
  `composeSystemPrompt`), `promptLibrary` (tested in `prompts.test.ts`),
  `mcpPresets` (`mcp-presets.test.ts`), `structuredOutput`
  (`structured-output.test.ts`), `mcp`/`mcp-http`/`mcp-tauri`
  (`mcp-transport.test.ts` + `mcpLifecycle`), `mcpConfig` (`mcpBridge.test.ts`
  + `mcpLifecycle`), `libreOfficeOnboarding` (`documentArtifact.test.tsx`).
- Borderline (transitively covered, no dedicated file): `db.ts` — factory
  functions `createMemoryKnowledgeDB`/`createIdbKnowledgeDB` are exercised via
  `rag`/`knowledge`/`hashCommand`/`workspaceRag` tests. Left out of M32 to
  avoid scope creep; can be revisited if a regression surfaces.

---

## M33 — Error-path test coverage & robustness (fifth analysis pass)

A fresh feature + gap analysis after M32. The repo is mature (vitest 1065,
cargo 87). This pass closed **error-path test gaps** across four surfaces
where happy paths were covered but failure paths were not. No merge to
`master` — work stays on `macOS-10.15`.

- [x] **#229** WebSearch error-path tests. `websearch.ts` catches a
  `web_search` invoke rejection → `[]` and a corrupt `localStorage` config →
  defaults; neither was tested. Added a `vi.mock('@tauri-apps/api/core')` seam
  + 4 tests (rejection fallback, no-throw, arg mapping, corrupt JSON).
- [x] **#230** Git service error-propagation tests. All six wrappers
  (`gitStatus/Diff/Stage/Unstage/Commit/Log`) only had happy-path tests;
  added 6 tests asserting each propagates the backend rejection (so the UI
  surfaces git errors instead of swallowing them).
- [x] **#231** Terminal service error-propagation tests. `startTerminal` /
  `killTerminal` only had happy-path tests; added 3 tests (terminal_run
  rejection, no session registered on failure, terminal_kill rejection).
- [x] **#232** Extract + test conversation import validation. The invalid-
  JSON / non-array error path lived inlined in `App.tsx handleImportFile`
  (untested). Extracted `parseSessionImport(text)` into `storage.ts`,
  wired `App.tsx` to call it, and added 7 tests (valid array, migration,
  invalid JSON, non-array, missing id, missing messages, non-object entry).

### Result
- `tsc --noEmit` clean; `vitest run` = **1085 passed (90 files)** (+20).
- `cargo test --lib` unchanged (87 passed) — no Rust changes this pass.

---

## M34 — Document-tool error tests & toggle ARIA state (sixth analysis pass)

A fresh feature + gap analysis after M33. Found two new gaps: the
`documentTools` thin wrappers had no rejection tests (same class hardened in
M33 for git/terminal), and several toggle controls exposed on/off / selected
state only visually (no ARIA) so screen readers couldn't perceive it. No merge
to `master` — work stays on `macOS-10.15`.

- [x] **#233** documentTools error-propagation tests. `readDocument` /
  `convertDocument` / `createDocument` / `documentFormats` are `tauriInvoke`
  pass-throughs with only happy-path tests; added 4 tests asserting each
  propagates the backend rejection.
- [x] **#234** ARIA state on toggle controls. Added `aria-pressed` to the four
  panel toggle buttons (artifacts / files / browser / terminal); replaced the
  hand-rolled agentic-mode switch with the accessible `Toggle` component
  (`role="switch"` + `aria-checked` + `aria-label`); added `aria-pressed` to the
  plan/ask/auto autonomy segmented buttons. Updated the existing e2e test to
  query the switch by `role="switch"`; added 3 App tests asserting the ARIA
  state. (`rg "aria-pressed" src-frontend` was 0 → now matches.)

### Result
- `tsc --noEmit` clean; `vitest run` = **1092 passed (90 files)** (+7).
- No Rust changes this pass.

---

## M35 — Browser-tool & PDF error-propagation tests (seventh analysis pass)

A fresh feature + gap analysis after M34. Rust error handling is well-guarded
(all non-test `unwrap`/`expect` are construction-safe: stdio is always piped,
char indexing is bounds-checked, `pending_run_start` is gated by
`is_some()`). The remaining gaps were the last two `tauriInvoke` pass-through
wrapper families without rejection tests — the browser CDP tools and the PDF
tools — so backend failures weren't asserted to propagate to the agent loop.
No merge to `master` — work stays on `macOS-10.15`.

- [x] **#235** browser-tools CDP wrapper error-propagation tests. The tool
  `execute` wrappers only had happy-path/approval/AX tests; added 5 rejection
  tests (`browser_snapshot`, `browser_screenshot`, `browser_read_console`,
  `browser_navigate` (localhost, engine pre-connected), `browser_click`).
- [x] **#236** documentsPdf error-propagation tests. Only `pdfMerge` had a
  rejection test; added 4 for `pdfInfo` / `pdfSplit` / `pdfExtract` /
  `pdfCreate`.

### Result
- `tsc --noEmit` clean; `vitest run` = **1101 passed (90 files)** (+9).
- `cargo test --lib` = 87 passed/1 ignored (no Rust changes this pass).

---

## M36 — Settings a11y labels & model-pull UI tests (eighth analysis pass)

A fresh feature + gap analysis after M35. Pivoted away from the exhausted
error-propagation theme. Found: (1) `rg "htmlFor" src-frontend/App.tsx` → 0
matches — no settings input had a programmatically associated label, and
several key inputs (system prompt, num_ctx, temperature, model-pull) relied on
placeholder/visual-only captions; (2) the model-pull UI flow (progress / error
/ retry / suggested-models) had no UI tests. No merge to `master` — work stays
on `macOS-10.15`.

- [x] **#237** Accessible names for settings inputs. Added `aria-label` to the
  system-prompt textarea, num_ctx, temperature, and model-pull inputs (matching
  the existing pattern used for the advanced sampling inputs). 3 App tests
  assert each is queryable by accessible name (`getByLabelText`).
- [x] **#238** Model-pull UI flow tests. New `test/modelPull.test.tsx` with a
  routed fetch mock (POST /api/pull → ReadableStream, GET /api/tags → model
  list): Download button for uninstalled suggested models, "Installed ✓" for
  present ones, error progress + Retry button on a failed pull, and progress
  text ("Pull complete") on a successful pull.

### Result
- `tsc --noEmit` clean; `vitest run` = **1108 passed (91 files)** (+7).
- No Rust changes this pass.

---

## M37 — Agentic plan/todo tool & tool-result rendering (comparative analysis)

A comparative functionality analysis against agentic GUIs/TUIs (Codex CLI
`update_plan`, Claude Code `TodoWrite`, Cursor/Aider todo panels, Codex/Claude
collapsible tool-call blocks). Baseline confirmed clean: `vitest` 1108 passed,
no production stubs/TODOs, all Rust commands wired, diff-review + websearch
grounding + cost/token display already present. Two genuine gaps found and
implemented. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#239** `update_plan` tool + live checklist UI. The project had no
  plan/todo tool and no plan visualization (the "plan" autonomy level had no
  structured surface). New `services/planStore.ts` (plan state + subscribe +
  `update_plan` tool, registered read-only so it needs no approval), new
  `components/PlanPanel.tsx` (checklist with ○/▶/✓ status icons + progress
  count), wired into `App.tsx` above the message list. 8 planStore + 3
  PlanPanel + 1 App-integration test.
- [x] **#240** Collapsible tool-result rendering. Tool messages were plain
  chat bubbles with a "Tool execution result" footer and no status; long
  output (`browser_snapshot`, `git_diff`, `document_read`) swelled the
  transcript. New inline `ToolResultBlock` renders a `<details>` with a
  summary (tool name + ✓/✗ status + one-line preview), collapsed by default
  for >12-line output, expanded for short output. Browser rich rendering and
  document artifacts untouched. 4 component tests.

### Result
- `tsc --noEmit` clean; `vitest run` = **1124 passed (95 files)** (+16).
- No Rust changes this pass.

---

## M38 — Reasoning/thinking support & context-budget indicator (comparative analysis)

A comparative functionality analysis vs ChatGPT/Claude/o3/Codex. Confirmed
existing strengths: @-file attach (#86), auto-compaction (#95), diff review,
cost/token display. Two genuine gaps found — one was both missing AND failing
(reasoning tokens discarded). No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#241** Reasoning/thinking support. Ollama reasoning models
  (deepseek-r1, gpt-oss, qwen3) emit `message.thinking` / top-level `thinking`,
  which the chat stream handler silently dropped (it read only
  `message.content`). Added `thinking` to `OllamaResponse` + `reasoning` to
  `Message`; the stream handler now accumulates `chunk.message?.thinking ??
  chunk.thinking` into `assistantReasoning` and persists it on the assistant
  message. New collapsible `ReasoningBlock` (💭 Thinking) renders the trace
  above the assistant content. 2 stream pass-through tests + 3 component tests.
- [x] **#242** Context-budget indicator. The footer showed an absolute token
  count but no sense of context-window fullness (Codex/Claude surface this).
  New `ContextBudget` component renders a fill bar + `%` of
  `conversationTokens / (num_ctx ?? 4096)`, color-coded green/amber/red at
  70/90%. 4 component tests.

### Result
- `tsc --noEmit` clean; `vitest run` = **1133 passed (97 files)** (+9).
- No Rust changes this pass.

---

## M39 — Copy message & reasoning parity for MLX/remote (comparative analysis)

A comparative functionality analysis vs Codex/Claude/Cursor. Confirmed code
blocks already have Copy; the 📋 button is the prompt library. Two gaps found
and implemented. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#243** Copy-assistant-message button. The assistant action row had
  thumbs / speak / regenerate but no copy (Codex/Claude/Cursor all have one).
  Added a `⧉` Copy button that writes `msg.content` to the clipboard and shows
  a `✓` copied state for 1.5s (`aria-label="Copy message"`). 1 UI test via the
  send/receive flow.
- [x] **#244** Reasoning parity for MLX + OpenAI-compatible connections.
  Reasoning capture landed for local Ollama (#241), but `streamOpenAiChat`
  (remote connections) and `fetchMlxChatStream` read only `delta.content`,
  dropping `reasoning_content`/`thinking` (DeepSeek via remote, etc.). Extended
  both `onChunk` signatures to `(delta, reasoning?)` (backward compatible) and
  wired the App.tsx MLX + connection branches to accumulate `assistantReasoning`
  and persist `msg.reasoning` so the existing `ReasoningBlock` renders it.
  4 stream tests (2 connections + 2 MLX).

### Result
- `tsc --noEmit` clean; `vitest run` = **1138 passed (98 files)** (+5).
- No Rust changes this pass.

---

## M40 — Agentic reasoning parity & markdown reasoning render (comparative analysis)

Continuation of reasoning/UX parity vs Codex/Claude/Cursor. Two gaps found and
implemented. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#245** Capture reasoning in the agentic loop. The standalone
  `agenticChatStream` (agent.ts) read Ollama stream lines directly but only
  accumulated `message.content`, dropping `message.thinking`/`thinking`
  (DeepSeek-R1, Qwen3, etc.). Added `onAssistantReasoning?` to
  `AgenticChatOptions`, accumulate `assistantReasoning` from the stream, invoke
  the callback, and include `reasoning` on the yielded assistant `Message`.
  Wired the App.tsx agentic branch to accumulate and persist reasoning so the
  existing `ReasoningBlock` renders it. 1 new agentic-stream test.
- [x] **#246** Render `ReasoningBlock` body as markdown. The block previously
  dumped reasoning text in a `whitespace-pre-wrap` div, so fenced code blocks
  and lists showed as raw ```` ``` ````/`-` instead of rendered markup. Switched
  the body to `MarkdownMessage` (same component as assistant content), keeping
  the `<details>` + 💭 Thinking summary shell. 2 new tests: fenced code →
  `CodeBlock` with a Copy button; list → `<ul>/<li>` markup.

### Result
- `tsc --noEmit` clean; `vitest run` = **1141 passed (98 files)** (+3).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M41 — In-chat search, shortcuts overlay & many-models reasoning (ninth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude GUI / Cursor / TUIs.
Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#247** In-conversation message search (Cmd/Ctrl+F). The app only
  searched across sessions in the sidebar (`searchSessions`); there was no
  find-within-current-conversation (Cursor/Claude Code/Codex TUI all have it).
  Added a `ChatSearch` component (`components/ChatSearch.tsx`) with a
  `findMessageMatches` helper (searches content + reasoning, case-insensitive),
  a sticky search bar with match count + prev/next + Enter/Shift+Enter +
  Escape, message-level ring highlight, and auto-scroll to the current match.
  Bound to Cmd/Ctrl+F (works even while focused in the chat input).
- [x] **#248** Complete keyboard-shortcuts help overlay + rebind files panel.
  The global handler wired Ctrl+B/Ctrl+F/Ctrl+T but the help overlay only
  listed New Chat / Sidebar / Settings / Close / Help. Completed the overlay to
  list Find in Chat (Ctrl+F), Toggle Browser (Ctrl+B), Toggle Files
  (Ctrl+Shift+F), Toggle Terminal (Ctrl+T). Rebound the file-tree panel toggle
  from Ctrl+F → Ctrl+Shift+F to free Cmd/Ctrl+F for in-conversation search,
  matching agentic-GUI conventions. Updated the footer hint.
- [x] **#249** Reasoning/thinking capture in the many-models fan-out.
  `runManyModels` surfaced only content (`chunk.message.content` / OpenAI
  `delta.content`) and dropped thinking/reasoning (DeepSeek-R1, Qwen3, etc.) —
  unlike the single-model paths (#241/#244/#245). Added an optional
  `reasoning` field to `ModelReply`, surfaced `chunk.message.thinking` /
  `chunk.thinking` (Ollama) and `reasoning_content` (OpenAI) via a new
  `onUpdate` reasoning param (backward compatible), and render a
  `ReasoningBlock` per reply card in the App.tsx many-models UI.

### Result
- `tsc --noEmit` clean; `vitest run` = **1157 passed (100 files)** (+16).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M42 — Composer drag/drop+paste, command palette & orchestrator reasoning (tenth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude GUI / Cursor / TUIs.
Three gaps found and implemented; #228 (shortcuts overlay) closed as resolved
by M41. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#250** Drag-and-drop + paste image attachment in the composer. The app
  only attached images via the paperclip button; Cursor/Claude/Codex all accept
  pasted or dragged images. Extracted a shared `attachImageFiles` pipeline
  (reuses `validateImageAttachments` + `FileReader`) and wired `onDrop`/
  `onDragOver`/`onDragLeave` to the composer (with a drag-over ring highlight)
  and `onPaste` to the chat input. Non-image drops/pastes are ignored.
- [x] **#251** Command palette (Ctrl/Cmd+P). The app bound Ctrl/Cmd+K to "new
  chat" only and had no unified quick-action palette (Cursor Cmd+K / VS Code
  Cmd+P / Claude command hub). Added a `CommandPalette` component
  (`components/CommandPalette.tsx`) with a `filterCommands` helper, a filter
  input, arrow-key navigation, Enter to run, Escape/backdrop to close, and
  commands for New Chat / Find in Chat / Toggle Sidebar / Browser / Files /
  Terminal / Open Settings / Show Shortcuts. Bound to Ctrl/Cmd+P (works while
  typing). Added to the shortcuts overlay + footer hint.
- [x] **#252** Reasoning/thinking capture in the cloud-brain orchestrator.
  `runCloudBrainLocalWorker` streamed each phase via `onDelta` but its
  `streamChat` helper read only `chunk.message.content` (and the MLX callback
  only `delta`), dropping thinking — unlike the single-model and many-models
  paths. Added an `onReasoning(phase, fullReasoning)` callback, surface
  `chunk.message.thinking`/`chunk.thinking` (Ollama) and the MLX `(delta,
  reasoning)` delta, and wired the App.tsx orchestrator branch to accumulate +
  persist `msg.reasoning` so `ReasoningBlock` renders it.

### Result
- `tsc --noEmit` clean; `vitest run` = **1181 passed (104 files)** (+24).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M43 — Per-hunk diff, message timestamps & M32 test hardening (eleventh analysis pass)

Comparative functionality analysis vs Codex GUI / Claude GUI / Cursor / TUIs.
Two new feature gaps implemented, plus the long-pending M32 test-coverage/cleanup
items rolled in and M32 closed. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#227** Remove the dead Tauri `greet` template stub. The `greet` command
  was never invoked from the frontend; removed the function and its
  `generate_handler!` registration. `cargo test --lib` still green (87 passed).
- [x] **#224** Ollama API error-handling, abort & timeout tests. Added an
  optional `timeoutMs` to `fetchOllamaChatStream` that combines the caller's
  `AbortSignal` with an internal timeout controller (cleared on
  success/error/abort). Added tests for non-ok errors, null body,
  `fetchOllamaModels` non-ok, malformed-line skipping, abort-signal
  propagation, timeout abort of a hanging stream, and timer cleanup.
- [x] **#225** Secrets keychain wrapper tests. The frontend `secretStore` only
  had in-memory-fallback coverage; added tests that mock `@tauri-apps/api/core`
  `invoke` to verify the `secret_set`/`secret_get`/`secret_delete` calls
  (args + return mapping), null handling, and graceful fallback to the
  in-memory store when invoke rejects.
- [x] **#253** Message timestamps. The `Message` interface had no timestamp and
  the chat rendered none (Claude Code / Cursor / Codex show send times). Added
  an optional `ts` field, set it on user + assistant messages (and preserved
  through streaming updates), added a `formatMessageTime` helper (same-day
  `HH:MM`, older `Mon D, HH:MM`), and render a `<time>` element in each
  message header. UI + unit tests added.
- [x] **#254** Per-hunk accept/reject in the diff review modal. The modal only
  accepted/rejected the whole edit (Cursor / Claude Code accept per-hunk).
  Extracted a `DiffReviewModal` component with `groupHunks`/`mergeHunks`
  helpers (consecutive change lines → hunks; reconstruct merged content
  applying only accepted hunks), per-hunk toggle buttons with `aria-pressed`,
  an Accept-all/Reject-all toggle, and `EditDecision.mergedNewString` so
  `proposeEdit` applies the merged content. `write_file` edits keep whole-file
  accept/reject. Unit + UI tests added.

### Result
- `tsc --noEmit` clean; `vitest run` = **1218 passed (108 files)** (+37).
- `cargo test --lib` = 87 passed / 1 ignored (greet stub removed).
- M32 closed (its remaining items #224/#225/#226/#227/#228 completed across
  M41–M43).

---

## M44 — New-messages badge, per-chat Markdown export & Escape-to-stop (twelfth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude GUI / Cursor / TUIs.
Three UX/parity gaps found and implemented. No merge to `master` — work stays
on `macOS-10.15`.

- [x] **#255** New-messages unread badge on the scroll-to-bottom button. The
  app auto-scroll-paused when the user scrolled up but gave no indication that
  new messages had arrived (Slack/Discord/Cursor show an unread count). Added
  `unreadCount` tracking (messages added while not near the bottom), a
  `↓ N new` badge on the scroll-to-bottom button, and reset-on-scroll-to-bottom
  (button click or scrolling back down). Accessible aria-label includes the
  count.
- [x] **#256** Per-conversation Markdown export. The app only exported all
  sessions as a JSON blob (Cursor/Claude export/copy a chat as Markdown). Added
  a `chatToMarkdown` helper (role headings + model + timestamp + content +
  reasoning blockquote + tool-call/image summaries) and an "Export
  conversation as Markdown" toolbar button (⬇️) that downloads a `.md` file
  for the current chat; disabled when empty.
- [x] **#257** Escape cancels an in-progress generation. The app only cancelled
  via the red Cancel button (Codex CLI / Claude Code use Escape/Ctrl+C to
  interrupt). Added Escape-to-cancel: when a generation is in progress and no
  search/palette/settings/help overlay is open, Escape aborts the stream. Also
  moved settings/help Escape handling before the "is typing" guard so Escape
  closes those overlays regardless of input focus.

### Result
- `tsc --noEmit` clean; `vitest run` = **1231 passed (112 files)** (+13).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M45 — Scroll-to-bottom on load, relative timestamps & multi-line composer (thirteenth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude GUI / Cursor / TUIs.
Three UX/parity gaps found and implemented. No merge to `master` — work stays
on `macOS-10.15`.

- [x] **#258** Loading a chat now scrolls to the bottom and clears any stale
  unread badge. Previously opening a long session left the view at the top
  (Codex/Claude/Cursor jump to the latest message). `loadSession` now sets
  `prevMsgCountRef` and a `scrollToEndOnLoadRef` flag, resets `unreadCount`,
  and the messages `useEffect` performs an instant jump-scroll on that load
  pass (`{ behavior: 'auto' }`).
- [x] **#259** Multi-line chat composer. The input was a single-line
  `<input>`; Codex/Claude/Cursor/TUIs all allow multi-line editing with
  Shift+Enter for newlines and Enter to send. Converted the composer to a
  `<textarea rows={1}>` with auto-grow (up to ~160px), `Enter` sends,
  `Shift+Enter` inserts a newline, and height resets after send.
- [x] **#260** Relative, live-updating message timestamps. Timestamps were
  static absolute strings; Codex/Claude/Slack show "just now" / "5m ago" /
  "3h ago" and refresh periodically. `formatMessageTime` now returns relative
  strings (<1m "just now", <1h "Nm ago", <24h "Nh ago", else absolute) and a
  60s `nowTick` interval refreshes the rendered times.

### Result
- `tsc --noEmit` clean; `vitest run` = **1241 passed (114 files)** (+10).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M46 — Copy-as-Markdown, conversation stats & /model slash command (fourteenth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / Cursor / TUIs.
Three UX/parity gaps found and implemented. No merge to `master` — work stays
on `macOS-10.15`.

- [x] **#261** Copy the current conversation as Markdown to the clipboard.
  Claude Code / Cursor let you copy a whole chat to the clipboard for pasting
  into notes/docs; the app only offered a per-chat `.md` *file* download
  (#256). Added a "Copy conversation as Markdown" toolbar button (📋, → ✓ on
  success) next to Export that writes `chatToMarkdown` output to
  `navigator.clipboard`, disabled when the chat is empty.
- [x] **#262** Conversation statistics. Cursor shows context stats and Claude
  Code shows token counts; the app had a context-budget bar but no per-chat
  totals. Added a `conversationStats` service (message / user / assistant /
  word / char / est.-token counts) and an `ConversationStatsButton` toolbar
  control (ℹ) that opens a small stats popover; hidden for empty chats.
- [x] **#263** `/model` slash command to switch the active model. Claude Code's
  TUI `/model` command switches the model inline; the app only switched via the
  dropdown. Registered `/model` as a builtin slash command: `/model <name>`
  switches the active model (validated against the loaded model list), `/model`
  with no argument reports the current model, and an unknown name shows a
  warning. A brief ephemeral status banner confirms each action.

### Result
- `tsc --noEmit` clean; `vitest run` = **1257 passed (118 files)** (+16).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M47 — Regenerate & focus-composer shortcuts + complete shortcuts overlay (fifteenth analysis pass)

Comparative functionality analysis vs Codex CLI / Claude Code / Cursor / TUIs.
Three keyboard-parity gaps found and implemented. No merge to `master` — work
stays on `macOS-10.15`.

- [x] **#264** Regenerate the last response via Ctrl/Cmd+R. Codex CLI and Claude
  Code retry the last reply with Ctrl+R; the app only regenerated via the
  on-message button. Added a `regenerateLastResponse` helper (finds the most
  recent assistant message and calls `regenerateMessage`) and a global
  Ctrl/Cmd+R shortcut (active when not typing and not already generating).
- [x] **#265** Focus the chat composer via Ctrl/Cmd+L. Cursor / ChatGPT / Claude
  Code offer a quick shortcut to jump focus back to the input. Added a global
  Ctrl/Cmd+L shortcut that focuses the `chat-input` textarea.
- [x] **#266** Complete the keyboard-shortcuts help overlay. The overlay (?)
  listed several bindings but omitted active ones. Added: Regenerate Last Reply
  (Ctrl+R), Focus Composer (Ctrl+L), Send Message (Enter), New Line in Composer
  (Shift+Enter) and Stop Generation / Close (Escape).

### Result
- `tsc --noEmit` clean; `vitest run` = **1262 passed (121 files)** (+5).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M48 — Up-arrow edit, per-message copy-as-Markdown & /rename command (sixteenth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / Cursor / ChatGPT /
TUIs. Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#267** Up-arrow edits the last user message. ChatGPT / Cursor / Claude
  Code let you press Up-arrow in an empty composer to jump straight into
  editing your last user message; the app only edited via the hover ✏ button.
  Added an ArrowUp handler in the composer: when the input is empty (and no
  slash/@/# suggestion menu is open, and nothing is generating) it finds the
  most recent user message and opens the inline editor.
- [x] **#268** Per-message Copy-as-Markdown. Cursor / Claude Code can copy an
  individual reply as formatted Markdown; the app only copied raw content (⧉).
  Extracted a `messageToMarkdown` helper (role heading + reasoning blockquote +
  content + tool/image summaries) and added a per-message "Copy message as
  Markdown" button (⎘) on assistant replies that writes it to the clipboard.
- [x] **#269** `/rename <title>` slash command. TUI chat tools rename the
  active thread inline; the app only renamed via the sidebar ✏ button. Added a
  `/rename` builtin that updates the current session title via
  `storage.updateSession` and refreshes the sidebar, with usage / "save the
  chat first" hints and an ephemeral status banner confirmation.

### Result
- `tsc --noEmit` clean; `vitest run` = **1274 passed (124 files)** (+12).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M49 — Regenerate-with-model, /export command & copy-last-reply shortcut (seventeenth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / Cursor / TUIs.
Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#270** Regenerate the last reply with a different model. Codex / Claude /
  Cursor let you retry the last response with a different model; the app only
  regenerated with the currently selected model. Added a model-override path
  through `sendMessage` (`activeModel = modelOverride ?? model`, used for
  endpoint resolution, the Ollama model name, the auto-compact summarizer and
  the `producedByModel` stamp), a `modelOverride` param on `regenerateMessage`,
  and a model-picker dropdown (↺▾) on the regenerate button that switches the
  active model and re-streams the last turn with the chosen model.
- [x] **#271** `/export` slash command. TUI chat tools export the active thread;
  the app only exported via the toolbar ⬇️ button. Added a `/export` builtin
  that downloads the current conversation as a Markdown file (reusing
  `handleExportMarkdown` / `chatToMarkdown`) with an empty-conversation hint
  and a status-banner confirmation.
- [x] **#272** Copy the last assistant reply via Ctrl/Cmd+Shift+C. Cursor offers
  a quick "copy last response" shortcut; the app only copied via the
  per-message ⧉ button. Added a global Ctrl/Cmd+Shift+C shortcut (when not
  typing) that copies the most recent assistant message to the clipboard and
  shows a "Copied last reply" toast. Documented in the shortcuts overlay.

### Result
- `tsc --noEmit` clean; `vitest run` = **1280 passed (127 files)** (+6).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M50 — Per-session drafts, date separators & theme-toggle shortcut (eighteenth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / Cursor / ChatGPT /
TUIs. Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#273** Per-session composer draft persistence. Cursor / Claude Code keep
  a per-conversation draft; the app used a single global input state, so
  switching chats carried the previous chat's half-typed text into the loaded
  chat. Added a `draftsRef` (sessionId → text), restored the saved draft in
  `loadSession`, and an effect that persists the current input to the active
  session's draft as it changes.
- [x] **#274** Date separators between messages. ChatGPT / Cursor render day
  dividers; the app only showed per-message relative timestamps. Added
  `formatDayLabel` (Today / Yesterday / "Mon D, YYYY") and `isSameDay` helpers
  and a divider row before the first message of each new calendar day in the
  message list (skipped when timestamps are missing).
- [x] **#275** Toggle dark/light theme via Ctrl/Cmd+Shift+D. The app only
  toggled theme via settings. Added a global Ctrl/Cmd+Shift+D shortcut (when
  not typing) that calls `toggleTheme`, and documented it in the
  keyboard-shortcuts overlay. Moved `updateTheme`/`toggleTheme` above the
  keydown effect so the closure stays fresh.

### Result
- `tsc --noEmit` clean; `vitest run` = **1291 passed (130 files)** (+11).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M51 — /search & /new slash commands and scroll-to-bottom shortcut (nineteenth analysis pass)

Comparative functionality analysis vs Codex CLI / Claude Code / Cursor / ChatGPT /
TUIs. Three TUI/UX-parity gaps found and implemented. No merge to `master` —
work stays on `macOS-10.15`.

- [x] **#276** `/search [query]` slash command. TUI chat tools search from the
  command line; the app only searched via the sidebar input. Added a `/search`
  builtin that opens the sidebar, optionally pre-fills the conversation search
  query, and focuses the search input (now `id="sidebar-search"`).
- [x] **#277** `/new` slash command. Claude Code's `/new` starts a fresh
  conversation; the app only started a new chat via the + button or `/clear`.
  Added a `/new` builtin (a clearer-named new-chat action) surfaced in the
  slash autocomplete.
- [x] **#278** Scroll to the latest message via Ctrl/Cmd+End. ChatGPT / Cursor
  offer a jump-to-latest shortcut; the app only scrolled to the bottom via the
  on-canvas button. Added a global Ctrl/Cmd+End shortcut (when not typing)
  that calls `scrollToBottom` (smooth scroll + clears the unread badge) and
  documented it in the keyboard-shortcuts overlay.

### Result
- `tsc --noEmit` clean; `vitest run` = **1300 passed (133 files)** (+9).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M52 — /copy command, delete-message & edit-assistant-message (twentieth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / Cursor / TUIs.
Three message/parity gaps found and implemented. No merge to `master` — work
stays on `macOS-10.15`.

- [x] **#279** `/copy` slash command. TUI chat tools copy a thread to the
  clipboard; the app copied via the toolbar 📋 button (#261) and downloaded a
  file via `/export` (#271) but had no slash command. Added a `/copy` builtin
  that copies the `chatToMarkdown` rendering to the clipboard and confirms via
  the status banner, with an empty-conversation hint.
- [x] **#280** Delete a single message. Codex / Claude / Cursor let you remove
  an individual message; the app could edit and regenerate but not delete one.
  Added a per-message Delete button (hover-revealed) on both user ("Delete
  message") and assistant ("Delete response") messages that removes the
  message, updates the trunk and persists — disabled while generating.
- [x] **#281** Edit an assistant message in place. Codex / Claude let you edit
  an assistant reply; the app only edited user messages (and re-sent). Added an
  "Edit response" button on assistant replies that opens the inline editor;
  saving replaces the content in place (no re-stream) and persists. Escape
  cancels. The edit block now branches on role (user → re-send, assistant →
  in-place replace).

### Result
- `tsc --noEmit` clean; `vitest run` = **1308 passed (136 files)** (+8).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M53 — /pin & /archive commands and quote-message-into-composer (twenty-first analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / Cursor / ChatGPT /
TUIs. Three parity gaps found and implemented. No merge to `master` — work
stays on `macOS-10.15`.

- [x] **#282** `/pin` slash command. TUI chat tools pin the active thread from
  the command line; the app only pinned via the sidebar 📌 button. Added a
  `/pin` builtin that toggles the current session's pinned state (via
  `togglePin`) and confirms via the status banner, with a save-first hint for
  temporary chats.
- [x] **#283** `/archive` slash command. Added a `/archive` builtin that
  toggles the current session's archived state (via `toggleArchive`) and
  confirms via the status banner, with a save-first hint.
- [x] **#284** Quote a message into the composer. ChatGPT / Cursor let you
  quote/reply to a specific message; the app had copy and edit but no
  quote-into-composer. Added a per-message Quote button (❝ — "Quote response"
  on assistant replies, "Quote message" on user messages) that inserts the
  message content as a Markdown blockquote draft (each line prefixed `> `),
  appending to any existing draft, and focuses the composer.

### Result
- `tsc --noEmit` clean; `vitest run` = **1316 passed (138 files)** (+8).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M54 — /tag command, duplicate conversation & /title command (twenty-second analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / Cursor / ChatGPT /
TUIs. Three organization/parity gaps found and implemented. No merge to
`master` — work stays on `macOS-10.15`.

- [x] **#285** `/tag <name>` slash command. TUI chat tools tag the active thread
  from the command line; the app only tagged via the sidebar 🏷 prompt. Added a
  `/tag` builtin that adds the tag to the current session (reusing the storage
  tag logic), confirms via the status banner, and shows usage / save-first
  hints. The tag chip renders in the sidebar.
- [x] **#286** Duplicate conversation. Cursor / ChatGPT let you duplicate a
  chat; the app had no duplicate action. Added a `duplicateSession` helper that
  creates a new session with a copy of the conversation (`Copy of <title>`,
  new id, unpinned/unarchived), a sidebar 📑 button on each session, and a
  `/duplicate` slash command for the current conversation.
- [x] **#287** `/title` slash command. ChatGPT can regenerate a chat title from
  its content; the app auto-titled on first save and renamed manually via
  `/rename` but couldn't re-derive the title. Added a `/title` builtin that
  recomputes `generateTitle(messages)` for the current session, persists it,
  refreshes the sidebar, and confirms via the status banner.

### Result
- `tsc --noEmit` clean; `vitest run` = **1328 passed (141 files)** (+12).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M55 — /folder & /system commands and raw/rendered toggle (twenty-third analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / Cursor / ChatGPT /
TUIs. Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#288** `/folder <name>` slash command. TUI chat tools organize the
  active thread from the command line; the app only moved chats to folders via
  the sidebar folder select. Added a `/folder` builtin that creates the folder
  if it doesn't exist and moves the current session into it (via
  `moveToFolder`), confirms via the status banner, and shows usage / save-first
  hints.
- [x] **#289** `/system [text]` slash command. Claude Code's `/system` sets or
  inspects the system prompt; the app only edited it via settings. Added a
  `/system` builtin: with text it sets and persists the system prompt; with no
  argument it shows the current prompt in the status banner.
- [x] **#290** Raw/rendered toggle per assistant message. Claude Code can view a
  message's raw text vs rendered Markdown; the app only rendered. Added a
  per-assistant-message toggle button (Raw / MD) that swaps the default
  Markdown render for a `whitespace-pre-wrap` raw view of the content.

### Result
- `tsc --noEmit` clean; `vitest run` = **1339 passed (144 files)** (+11).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M56 — /temp & /ctx commands and collapse long messages (twenty-fourth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / Cursor / ChatGPT /
TUIs. Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#291** `/temp <value>` slash command. ChatGPT / Claude sliders set the
  sampling temperature; the app only exposed it in settings. Added a `/temp`
  builtin: with a value in 0..2 it sets and persists `genOptions.temperature`;
  with no argument it shows the current value ("Temperature: default" when at
  the default); out-of-range shows a usage hint.
- [x] **#292** `/ctx <value>` slash command. Codex / Claude let you size the
  context window; the app only set `num_ctx` in settings. Added a `/ctx` builtin:
  with a value >= 512 it sets and persists `genOptions.num_ctx`; with no argument
  it shows the current value (default 4096); too-small shows a hint.
- [x] **#293** Collapse long messages with Show more / Show less. ChatGPT and
  Claude collapse very long replies behind a "Show more" affordance; the app
  always rendered full height. Added a per-message clamp (`max-h-60
  overflow-hidden`) with a "Show more" / "Show less" toggle button for messages
  whose body exceeds 1000 characters; short messages render unchanged.

### Result
- `tsc --noEmit` clean; `vitest run` = **1351 passed (146 files)** (+12).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M57 — /topp, /predict & /stop slash commands (twenty-fifth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / Cursor / ChatGPT /
TUIs. Three gaps found and implemented — completing command-line control of every
`GenerationOptions` field. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#294** `/topp <value>` slash command. ChatGPT / Codex expose nucleus
  sampling (top_p) in their UI; the app only set it in the settings panel. Added
  a `/topp` builtin: with a value in 0..1 it sets and persists
  `genOptions.top_p`; with no argument it shows the current value ("Top-p:
  default" when unset); out-of-range shows a usage hint.
- [x] **#295** `/predict <value>` slash command. ChatGPT / Codex / Claude let you
  cap the max reply length; the app only set `num_predict` in settings. Added a
  `/predict` builtin: with a positive integer (or -1 for unlimited) it sets and
  persists `genOptions.num_predict`; with no argument it shows the current value
  ("Max tokens: unlimited" when unset); invalid input shows a hint.
- [x] **#296** `/stop <seq>` slash command. Ollama supports stop sequences in
  `GenerationOptions`; Codex / Claude TUIs let you set them from the command
  line. Added a `/stop` builtin: with comma-separated values it sets and
  persists `genOptions.stop` as an array; with no argument it shows the current
  sequences ("none" when unset); with `clear` it removes all stop sequences.

### Result
- `tsc --noEmit` clean; `vitest run` = **1366 passed (146 files)** (+15).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M58 — Generation speed, /topk command & retry button (twenty-sixth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / LM Studio / Open
WebUI / ChatGPT / TUIs. Three gaps found and implemented. No merge to `master` —
work stays on `macOS-10.15`.

- [x] **#297** Generation speed indicator (tokens/sec). LM Studio, Open WebUI,
  and other Ollama GUIs display generation speed and token counts after a reply
  completes; Codex / Claude show response timing. The Ollama API sends
  `eval_count`, `eval_duration`, and `total_duration` in the final `done:true`
  stream chunk, but the app ignored them. Extended `OllamaResponse` with the
  stats fields, added `computeGenStats()` (converts nanosecond durations to
  tokens/sec + ms), stamped `genStats` on the assistant message, and rendered
  "tok/s" and "tokens" in the message header.
- [x] **#298** `/topk <value>` slash command. The app exposes `top_k` in the
  settings panel and has `/temp`, `/ctx`, `/topp`, `/predict`, `/stop` commands,
  but `top_k` was the last `GenerationOptions` field without a command. Added a
  `/topk` builtin: with a non-negative integer it sets and persists
  `genOptions.top_k` (0 = disabled); with no argument it shows the current value
  ("Top-k: default" when unset); negative values show a hint.
- [x] **#299** Retry button on failed/error messages. When a generation fails
  (network error, timeout), the app replaced the partial reply with an error
  line but offered no quick retry — Codex / Claude GUIs show a Retry affordance
  after failures. Added an `isError` flag to error assistant messages and
  rendered a "↻ Retry" button that removes the error placeholder and re-sends
  the last user prompt.

### Result
- `tsc --noEmit` clean; `vitest run` = **1377 passed (147 files)** (+11).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M59 — Next/prev conversation, composer counter & /cost command (twenty-seventh analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / ChatGPT / Discord /
Slack / TUIs. Three gaps found and implemented. No merge to `master` — work stays
on `macOS-10.15`.

- [x] **#300** Next/Previous conversation keyboard shortcut (Ctrl+] / Ctrl+[).
  ChatGPT, Discord, Slack, and many chat GUIs let users cycle through
  conversations with keyboard shortcuts; the app required clicking a sidebar
  session. Added `switchConversation(direction)` that loads the next/previous
  session from the filtered session list, wired to Ctrl+] (next) and Ctrl+[
  (previous). Uses a ref so the keyboard handler (declared earlier) can call it
  without use-before-declaration. Shortcuts added to the help overlay.
- [x] **#301** Live word/character counter in the composer. Many TUIs and chat
  GUIs show a word/char count for the current draft; the app only showed an
  estimated token count for the whole conversation. Added a compact counter below
  the composer textarea ("N words · M chars") that appears only when the user
  has typed something.
- [x] **#302** `/cost` slash command. Claude Code has a `/cost` command that
  shows token usage and cost for the current session; the app computed
  `conversationTokens` and `formatCost` for the footer but had no on-demand
  command. Added a `/cost` builtin that shows the token count, estimated cost,
  and context budget percentage in the status banner.

### Result
- `tsc --noEmit` clean; `vitest run` = **1383 passed (148 files)** (+6).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M60 — Continue generation, per-message export & /compact command (twenty-eighth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / ChatGPT / TUIs.
Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#303** Continue generation button on stopped/cancelled replies. Codex
  and Claude show a Continue button after an interrupted reply, letting the
  model resume from where it stopped. The app appended "*(generation cancelled)*"
  but offered no way to continue. Added a `wasCancelled` flag to cancelled
  assistant messages and a "▶ Continue" button that strips the cancellation
  marker, re-sends the conversation (including the partial assistant content) to
  the model, and appends the streamed response to the existing message.
- [x] **#304** Export individual message as a Markdown file. The app exports the
  whole conversation as Markdown but could not export a single message. Added a
  per-message "⬇" download button that saves the message (with role header) as a
  `.md` file via `messageToMarkdown`.
- [x] **#305** `/compact` slash command. Claude Code has a `/compact` command
  that summarizes the conversation to save context window space. The app had no
  such feature — long conversations eventually exceed `num_ctx`. Added a
  `/compact` builtin that sends a summarization prompt to the model, captures the
  summary, and replaces the conversation history with a single user message
  containing the summary (preserving model and system prompt). Rejects when there
  are fewer than 2 messages or a generation is in progress.

### Result
- `tsc --noEmit` clean; `vitest run` = **1389 passed (149 files)** (+6).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M61 — Tag filter, completion notification & scroll-to-top (twenty-ninth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / ChatGPT / TUIs.
Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#306** Click-to-filter by tag in the sidebar. The app displayed tags on
  sessions but clicking a tag only exposed the remove (×) button — there was no
  way to filter sessions by tag. Made the tag text clickable to toggle a tag
  filter that narrows the sidebar to sessions with that tag. Added a clear-filter
  chip ("🏷 tag ✕") next to the folder/archive filter chips.
- [x] **#307** Browser notification when generation completes (tab unfocused).
  When a user switches away from the app while a generation is running, there
  was no indication when it completed. Added a browser `Notification` (with the
  model name and a reply snippet) that fires when generation finishes and
  `document.hidden` is true, requiring `Notification.permission === 'granted'`.
- [x] **#308** Scroll-to-top button (Back to top). The app had a scroll-to-bottom
  button but no scroll-to-top. Added a "↑ Back to top" button that appears when
  the user scrolls down past 300px and smooth-scrolls to the first message on
  click.

### Result
- `tsc --noEmit` clean; `vitest run` = **1393 passed (150 files)** (+4).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M62 — Zen mode, notification permission & /delete command (thirtieth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / ChatGPT / TUIs.
Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#309** Zen/Focus mode (Ctrl+Shift+Z). Codex CLI and Claude Code have
  minimal, distraction-free interfaces; many chat GUIs offer a focus/zen mode.
  The app always showed the sidebar, header, and side panels. Added a zen mode
  toggle that hides the sidebar, closes all open panels, and restores them when
  toggled off. Added to the keyboard shortcuts help overlay.
- [x] **#310** Browser notification permission request flow. The app fired a
  browser Notification on completion (#307) but only when permission was already
  granted — there was no way to request it. Added a "Notify on completion"
  settings toggle that calls `Notification.requestPermission()` when enabled and
  persists to localStorage. Notifications only fire when the toggle is on.
- [x] **#311** `/delete` slash command. The app let users delete conversations
  via the sidebar ✕ button but had no slash command for it. Added a `/delete`
  builtin that triggers the delete confirmation dialog for the current
  conversation — mirroring the sidebar delete action.

### Result
- `tsc --noEmit` clean; `vitest run` = **1399 passed (151 files)** (+6).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M63 — Code block collapse, model info in selector & /models command (thirty-first analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / LM Studio / Open
WebUI / TUIs. Three gaps found and implemented. No merge to `master` — work
stays on `macOS-10.15`.

- [x] **#312** Collapsible long code blocks with expand/collapse. Codex and
  Claude collapse long code blocks behind an expand affordance, keeping the chat
  scrollable. The app's `CodeBlock` always rendered at full height — a 200-line
  dump dominated the screen. Added a 20-line threshold: blocks exceeding it get
  a `max-h-96` clamp with a "Show all N lines" gradient overlay button; clicking
  expands to full height with a "Collapse" button at the bottom. The header shows
  the line count when collapsible.
- [x] **#313** Parameter size and quantization in the model selector dropdown.
  LM Studio and Open WebUI show model metadata in the picker. The app's
  `ModelInfo` carried `parameterSize`, `quantization`, and `size` but the
  dropdown only showed the bare name. Appended parameter size and quantization to
  each local model option and parameter size to each cloud model option.
- [x] **#314** `/models` slash command. Codex CLI and Claude Code TUIs have a
  command to list available models. The app's `/model` showed the current model
  but didn't list all. Added a `/models` builtin (distinct from `/model`) that
  lists all local and cloud models with parameter size and quantization in the
  status banner.

### Result
- `tsc --noEmit` clean; `vitest run` = **1405 passed (152 files)** (+6).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M64 — System prompt presets, /pull command & sidebar message counts (thirty-second analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / ChatGPT / LM
Studio / TUIs. Three gaps found and implemented. No merge to `master` — work
stays on `macOS-10.15`.

- [x] **#315** System prompt preset templates. Claude Code and Codex let users
  quickly switch the AI's persona/role. The app had a free-text system prompt
  field but no preset templates. Added a "Persona presets" dropdown next to the
  system prompt textarea in settings with five built-in presets: Default, Coding
  assistant, Creative writer, Concise responder, Translator, and Custom (clear).
  Selecting one fills the textarea.
- [x] **#316** `/pull <model>` slash command. The app pulled models via the
  settings UI but had no slash command for it. Added a `/pull` builtin that
  triggers `handlePullModel` for the given model name, shows a "Pulling…"
  status banner, and auto-selects the model when done. No-arg shows usage.
- [x] **#317** Message count per session in the sidebar. ChatGPT and many chat
  GUIs show the message count next to each conversation. The app showed only the
  title and tags. Added a compact "N msgs" count below each session title for
  sessions with messages; empty sessions show no count.

### Result
- `tsc --noEmit` clean; `vitest run` = **1412 passed (153 files)** (+7).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).
- Fixed two existing tests affected by the sidebar title structure change
  (`pinArchiveCommands.test.tsx` selector) and the presets dropdown aria-label
  (`App.test.tsx` accessible-name match).

---

## M65 — /remove command, context warning & completion sound (thirty-third analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / TUIs. Three gaps
found and implemented. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#318** `/remove <model>` slash command. The app deleted models via the
  settings UI (`handleDeleteModel` with confirmation) but had no slash command.
  Added a `/remove` builtin that triggers `handleDeleteModel` for the given model
  name. No-arg shows usage; unknown model shows "not found".
- [x] **#319** Context limit warning banner. The app showed a `ContextBudget`
  progress bar in the footer but provided no explicit warning when the
  conversation was about to exceed the context window. Added a dismissible amber
  warning banner at the top of the chat area when context usage exceeds 80%,
  suggesting `/compact` or `/ctx <larger>`. Auto-resets the dismissed flag when
  usage drops back below 80%.
- [x] **#320** Optional completion sound. Codex CLI and some TUIs provide audio
  feedback when a long-running task completes. Added a "Play sound on completion"
  settings toggle that plays a short 880 Hz beep via the Web Audio API when a
  reply finishes. Persisted to localStorage; off by default.

### Result
- `tsc --noEmit` clean; `vitest run` = **1419 passed (154 files)** (+7).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

---

## M66 — Pin shortcut, recent models & /export json (thirty-fourth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / ChatGPT / LM
Studio / TUIs. Three gaps found and implemented. No merge to `master` — work
stays on `macOS-10.15`.

- [x] **#321** Keyboard shortcut to pin/unpin the current conversation
  (Ctrl+Shift+P). The app pinned conversations via the sidebar 📌 button or
  `/pin` command but had no keyboard shortcut. Added Ctrl+Shift+P to toggle pin
  on the current conversation with a status banner confirmation. Fixed the
  command palette shortcut (Ctrl+P) to not trigger on Ctrl+Shift+P. Added to the
  help overlay.
- [x] **#322** Recent models tracking and quick-switch. LM Studio and Open WebUI
  show recently used models at the top of the picker. The app's model selector
  listed all models with no recency tracking. Added a `recentModels` state that
  tracks the last 5 used models in localStorage (updated on every `sendMessage`)
  and displays them in a "— Recent —" optgroup at the top of the model selector
  dropdown.
- [x] **#323** `/export json` slash command. The app exported all sessions as
  JSON via a UI button and the current conversation as Markdown via `/export`.
  There was no way to export just the current conversation as JSON from the
  command line. Extended the `/export` command to accept a `json` argument —
  `/export json` downloads the current conversation (with session metadata) as a
  `.json` file.

### Result
- `tsc --noEmit` clean; `vitest run` = **1423 passed (155 files)** (+4).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M67 — Connection status, params badge & /params command (thirty-fifth analysis pass)

Comparative functionality analysis vs Codex GUI / Claude Code / ChatGPT / LM
Studio / Open WebUI / TUIs. Three gaps found and implemented. No merge to
`master` — work stays on `macOS-10.15`.

- [x] **#324** Ollama connection status indicator in the header. Codex CLI and
  LM Studio show a live connection/health indicator so the user knows whether
  the backend is reachable. The app had no such indicator — model fetch failures
  were only logged to the console. Added an `ollamaConnected` state (`null` =
  unknown, `true`/`false` after the first model fetch) and a small coloured
  status dot in the chat header (green = connected, red = disconnected, gray =
  unknown) with a tooltip showing the base URL.
- [x] **#325** Generation parameters badge in the chat header. ChatGPT and Open
  WebUI surface the active temperature/context settings compactly so users can
  see the current configuration at a glance. The app only exposed these in the
  settings panel. Added a compact `T:<temp> · CTX:<num_ctx>` badge next to the
  model selector that reflects the current `genOptions` (defaults shown when
  unset) with a full tooltip listing all parameters.
- [x] **#326** `/params` slash command to show all generation options. Each
  parameter had its own command (`/temp`, `/ctx`, etc.) but there was no single
  command to display the complete generation configuration. Added the `/params`
  builtin that shows a status banner with Temperature, Context, Top-p, Top-k,
  Max tokens, and Stop sequences in one line.

### Result
- `tsc --noEmit` clean; `vitest run` = **1433 passed (156 files)** (+10).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M68 — Sidebar sort, /stats command & keyboard session nav (thirty-sixth analysis pass)

Comparative functionality analysis vs Codex CLI / Claude Code / ChatGPT / Open
WebUI / TUIs. Three gaps found and implemented. No merge to `master` — work
stays on `macOS-10.15`.

- [x] **#327** Conversation-list sort options in the sidebar. ChatGPT and Open
  WebUI let users change the sort order of the conversation list; the app only
  sorted pinned-first then newest-first with no UI to change it. Added a
  `sortMode` state (`recent` / `name` / `messages`) with a compact sort selector
  in the sidebar, persisted to `localStorage` (`ollama_gui_sort_mode`). Added a
  `sortSessions` helper in `services/storage.ts` that applies the chosen
  ordering while keeping pinned sessions on top. `filteredSessions` now uses
  `sortSessions` instead of `orderSessions`.
- [x] **#328** `/stats` slash command for conversation statistics. The app
  exposed stats (message count, user/assistant split, words, characters, est.
  tokens) only via the ℹ toolbar button — no command-line equivalent. Added the
  `/stats` builtin that shows the full breakdown in the status banner, giving
  TUI/command-line parity with the stats button.
- [x] **#329** Keyboard arrow navigation in the conversation list. Codex CLI and
  TUIs let users move through a list with ArrowUp/ArrowDown. Session rows were
  individually focusable with an Enter handler but had no arrow-key movement
  between rows. Added ArrowUp/ArrowDown handling on session rows that moves
  focus to the previous/next visible session; Enter loads the focused session.
  The existing Ctrl+] / Ctrl+[ next/prev-conversation shortcuts are unchanged.

### Result
- `tsc --noEmit` clean; `vitest run` = **1452 passed (158 files)** (+19).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M69 — Date-grouped sidebar, /id command & prompt history (thirty-seventh analysis pass)

Comparative functionality analysis vs ChatGPT / Codex CLI / Claude Code / TUIs.
Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#330** Date-grouped conversation list in the sidebar. ChatGPT groups the
  conversation list by date buckets (Today, Yesterday, Previous 7 Days, Older)
  so users can quickly find recent chats. The app rendered a flat list with only
  a "History" header. Added a `conversationDateBucket` helper in
  `services/formatTime.ts` and grouped the sidebar session list into Pinned /
  Today / Yesterday / Previous 7 Days / Older sections with labels. Date
  grouping applies only in the default `recent` sort mode; `name` and `messages`
  sorts render a flat list. Arrow-key navigation (#329) still works across
  groups because rows remain direct children of the scroll container (React
  Fragments add no DOM nodes).
- [x] **#331** `/id` slash command to show and copy the current session ID.
  Developer-focused TUIs (Codex CLI, Claude Code) expose the current session
  identifier for debugging and sharing. The app had no command-line way to view
  or copy the active session ID. Added the `/id` builtin that shows the session
  ID in the status banner and copies it to the clipboard (or "No active
  session" when temporary).
- [x] **#332** Prompt history navigation in the composer (Alt+Up / Alt+Down).
  Shells, Codex CLI and Claude Code let users recall previously sent prompts.
  The app's Up-arrow edits the last user message but there was no way to cycle
  through a history of sent prompts to re-use them. Added per-session prompt
  history (collected from every sent non-slash prompt, capped at 50) and
  Alt+Up / Alt+Down to cycle backward/forward, filling the composer without
  modifying the conversation. Added `!e.altKey` to the existing Up-arrow
  edit-last-message guard so the two behaviours don't conflict.

### Result
- `tsc --noEmit` clean; `vitest run` = **1468 passed (159 files)** (+16).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M70 — Plain-text export, model badge & slash command reference (thirty-eighth analysis pass)

Comparative gap analysis vs Codex CLI / Claude Code / LM Studio / ChatGPT. Three
gaps found and implemented. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#333** `/export txt` plain-text export. The app exported conversations as
  Markdown (`/export`) and JSON (`/export json`) but had no plain-text export,
  which Codex CLI and TUIs favour for piping into other tools. Added a
  `chatToPlainText` / `messageToPlainText` helper to `services/chatToMarkdown.ts`
  that strips markdown syntax to a simple "Role: content" format, and extended
  `/export` to accept a `txt` argument that downloads a `.txt` file.
- [x] **#334** Per-session model badge in the sidebar. LM Studio and Open WebUI
  show which model a conversation used, helping users identify chats in a
  multi-model setup. The session rows showed only the title and message count.
  Added a compact, truncated model label to each session row (with a
  "Model: <name>" tooltip) using `session.model`.
- [x] **#335** Slash command reference in the help overlay. Codex CLI and Claude
  Code show their available commands in the help/reference view. The app's help
  overlay (`?` or `/help`) listed only keyboard shortcuts. Added a "Slash
  Commands" section that lists every builtin command (name + description) from
  `getAllCommands()`, in a scrollable area alongside the existing shortcuts.

### Result
- `tsc --noEmit` clean; `vitest run` = **1477 passed (160 files)** (+9).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M71 — Code word-wrap, /copy txt & bulk sidebar actions (thirty-ninth analysis pass)

Comparative gap analysis vs Codex CLI / Claude Code / ChatGPT. Three gaps found
and implemented. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#336** Word-wrap toggle for code blocks. Codex CLI and many TUIs wrap
  long code lines instead of horizontal-scrolling. The app's code blocks used
  `overflow-x-auto` with no wrap option. Added a global `codeWordWrap` state
  (persisted to `localStorage`, `ollama_gui_code_wordwrap`) shared with every
  `CodeBlock` via a `CodeWordWrapContext`, plus a per-block "Wrap" toggle button
  in the code header. When enabled, code uses `white-space: pre-wrap;
  word-break: break-word` instead of scrolling.
- [x] **#337** `/copy txt` plain-text clipboard copy. `/copy` copied the
  conversation as Markdown and `/export txt` downloaded plain text, but there
  was no way to copy plain text to the clipboard directly. Extended `/copy` to
  accept a `txt` argument that copies the conversation as plain text (via
  `chatToPlainText`) to the clipboard, mirroring `/export txt`.
- [x] **#338** Bulk selection and bulk archive/delete in the conversation list.
  ChatGPT lets users multi-select conversations and bulk-archive or bulk-delete
  them; the app only supported per-conversation hover actions. Added a "Select"
  toggle in the sidebar that reveals checkboxes on session rows. In select mode,
  clicking a row toggles its selection instead of loading it. A bulk action bar
  offers Archive (N), Delete (N) (with a confirmation dialog), and Cancel.

### Result
- `tsc --noEmit` clean; `vitest run` = **1487 passed (161 files)** (+10).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M72 — Model starring, per-message tokens & copy-as-plain-text (fortieth analysis pass)

Comparative gap analysis vs Codex CLI / Claude Code / ChatGPT / LM Studio / Open
WebUI. Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#339** Model favourite/starring in the model selector. LM Studio and
  Open WebUI let users star/favourite models so they pin to the top of the
  picker. The app tracked recently-used models but had no favourites. Added a
  `starredModels` state persisted to `localStorage`
  (`ollama_gui_starred_models`), a ★/☆ toggle button next to the model selector
  for the active model, and a "— ★ Starred —" optgroup at the top of the
  selector listing starred models that are still available.
- [x] **#340** Per-message estimated token count badge. Codex CLI, Claude Code
  and ChatGPT surface token usage so users understand context consumption. The
  app showed generation stats (tok/s, eval count) on assistant messages and a
  conversation-level estimate, but no per-message estimate. Added a compact
  `≈Nt` badge to each non-empty message (using `estimateTokens`) in the message
  meta row with an "Estimated tokens: N" accessible label.
- [x] **#341** Per-message copy-as-plain-text button. The app offered
  per-message "Copy message" (raw), "Copy message as Markdown", and "Download as
  Markdown", plus conversation-level `/copy txt` — but no per-message
  copy-as-plain-text that strips markdown. Added a "T" button next to the
  existing copy buttons that copies `messageToPlainText(msg)` to the clipboard
  with a ✓ confirmation, paralleling `/copy txt`.

### Result
- `tsc --noEmit` clean; `vitest run` = **1495 passed (162 files)** (+8).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M73 — Font zoom, /export html & conversation merge (forty-first analysis pass)

Comparative gap analysis vs ChatGPT / VS Code / Codex CLI / Claude Code. Three
gaps found and implemented. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#342** Font-size / zoom control. ChatGPT, VS Code, Codex CLI and Claude
  Code all offer font-size / zoom controls; the app had none. Added a `fontScale`
  state (default 1, clamped 0.8–1.5) persisted to `localStorage`
  (`ollama_gui_font_scale`), applied to the document root font-size so Tailwind
  rem-based sizing scales uniformly. Added Ctrl+= / Ctrl+- / Ctrl+0 shortcuts to
  increase / decrease / reset zoom with a status banner, and listed them in the
  help overlay.
- [x] **#343** `/export html` self-contained HTML export. The app exported as
  Markdown, JSON, and plain text but not HTML. Added a `chatToHtml` /
  `messageToHtml` helper to `services/chatToMarkdown.ts` that renders a
  self-contained styled HTML document (escaped content, fenced code blocks as
  `<pre><code>`, role class hooks). Extended `/export` to accept an `html`
  argument that downloads a `.html` file.
- [x] **#344** `/merge <id>` conversation merge. The app had `/duplicate` but no
  way to combine two conversations. Added the `/merge` builtin that appends
  another session's messages into the current conversation, saves, and confirms.
  Refuses on unknown id, self-merge, empty target, or no active session. Pairs
  naturally with `/id` to retrieve a session id.

### Result
- `tsc --noEmit` clean; `vitest run` = **1513 passed (163 files)** (+18).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M74 — /clear in-place, /undo & /diff (forty-second analysis pass)

Comparative gap analysis vs ChatGPT / Claude Code / Aider / Codex CLI. Three
gaps found and implemented. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#345** `/clear` clears messages in-place (keep session). `/clear` and
  `/new` were semantically identical (both called `startNewChat()`, dropping the
  session). ChatGPT, Claude, and TUIs distinguish clearing the current
  conversation's messages (preserving the session entry) from starting a fresh
  session. `/clear` now resets messages/branch state/attachments and persists an
  empty message list to the existing session; `/new` keeps its new-session
  behaviour.
- [x] **#346** `/undo` slash command — drop the last user+assistant exchange.
  The app had file-state checkpoints/rewind but no message-level undo (Aider
  `/undo`, ChatGPT message undo). Added the `/undo` builtin that removes the
  trailing assistant reply plus the preceding user message, persists the trimmed
  conversation, and refuses when empty or while generating.
- [x] **#347** `/diff` slash command — feed the current git diff into chat
  context. The workspace had a Git panel and a `git_diff` agent tool, but no
  quick way for the user to inject the uncommitted diff for the model to review
  (Aider/Claude routinely feed diffs to the model). Added the `/diff` builtin
  that calls `gitDiff(workspaceRoot)` and sends the diff as a user message;
  `/diff staged` uses the staged diff. Refuses with no workspace or while
  generating.

### Result
- `tsc --noEmit` clean; `vitest run` = **1524 passed (164 files)** (+11).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M75 — /reset, /tokens & pinned-file context (forty-third analysis pass)

Comparative gap analysis vs Codex CLI, Claude Code, ChatGPT, and Aider (TUI).
Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#348** `/reset` generation parameters to defaults. The app exposed
  `/temp`, `/ctx`, `/topp`, `/topk`, `/predict`, `/stop` and `/params` (view)
  but had no one-step reset. ChatGPT, Claude, and LM Studio all offer
  reset-to-defaults. Added the `/reset` builtin that restores `genOptions` to
  `{ num_ctx: 4096 }` (clearing temperature/top_p/top_k/num_predict/stop) and
  confirms via banner.
- [x] **#349** `/tokens` per-source context token breakdown. `/cost` and
  `/stats` showed conversation totals but not *where* context tokens are spent.
  Codex CLI surfaces a per-source context breakdown. Added the `/tokens`
  builtin that composes the same context sources used at send time and prints
  an estimated-token breakdown (project rules, instructions, memory, system
  prompt, pinned files, conversation, pending input) with a total vs `num_ctx`.
- [x] **#350** Aider-style `/add` & `/drop` pinned-file context. The app had
  one-shot `@`-mention but no persistent pinned files across turns. Added a
  `pinnedFiles` state (persisted to `localStorage`) with `/add <path>`,
  `/drop <path>`, and `/files`; pinned contents are prepended as `<file>` context
  blocks on every send, shown as removable chips above the composer, and cleared
  on `/new` and `/clear`. New `services/pinnedFiles.ts`.

### Result
- `tsc --noEmit` clean; `vitest run` = **1556 passed (166 files)** (+32).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M76 — Image lightbox, interactive task lists & /run (forty-fourth analysis pass)

Comparative gap analysis vs ChatGPT, Claude, Obsidian/Typora, and Aider (TUI).
Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#351** Image lightbox / full-size preview. Attached images rendered only
  as thumbnails; ChatGPT/Claude open images in a full-size overlay. Added a
  `lightboxImage` state + full-screen overlay (closeable via ✕, backdrop click,
  or Escape — including a global Escape handler). Pending and in-message images
  are now click-to-zoom.
- [x] **#352** Interactive GFM task-list checkboxes. remark-gfm rendered task
  lists with disabled, non-clickable checkboxes; Obsidian/ChatGPT/Typora make
  them interactive. Added `services/taskList.ts` (`toggleTaskInMarkdown`,
  `reactChildrenToText`, `hasTaskList`, `extractTaskText`) and a custom `li`
  renderer in `MarkdownMessage` that swaps the disabled input for a clickable
  checkbox; clicking toggles `- [ ]`↔`[x]` in the stored message and persists.
- [x] **#353** `/run <command>` — Aider-style shell-command-to-chat. The app had
  a terminal panel and an agent CLI tool (with approval) but no quick way to run
  a command and feed its output to the model. Added a one-shot `runCliOnce`
  wrapper (with a `_cliMocks` test seam) in `services/tools.ts` and a `/run`
  builtin that runs the command (user-initiated, no approval — like the terminal
  panel) and sends the output into chat as a user message.

### Result
- `tsc --noEmit` clean; `vitest run` = **1577 passed (168 files)** (+21).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M77 — External links, autonomy quick-selector & resume-last-session (forty-fifth analysis pass)

Comparative gap analysis vs Codex GUI, Claude Code, and ChatGPT. Three gaps
found and implemented (one a bug). No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#354** Markdown links open in the system browser (bug). `MarkdownMessage`
  had no custom `a` renderer, so links navigated the Tauri webview / no-op'd
  instead of opening in the OS browser like citations and ChatGPT/Claude/Codex
  do. Added `services/openExternal.ts` (`openExternalUrl`, `isExternalUrl`, with
  a `_mocks` test seam) and an `a` renderer that hands http(s) links to the
  opener plugin (window.open fallback), preventing default navigation.
- [x] **#355** Autonomy / approval-mode quick selector in the chat header. The
  Plan/Ask/Auto selector lived only in Settings; the Codex GUI surfaces a
  prominent approval-mode selector in the main view. Added a compact segmented
  selector to the chat header (bound to `autonomySettings.level`, persisted via
  `saveAutonomySettings`) plus three Command Palette entries.
- [x] **#356** Opt-in resume-last-session on startup. The app always opened a
  blank chat; Claude Code resumes the most recent conversation. Added a
  `resumeLastSession` setting (localStorage, default off) that, on mount, loads
  the most recent non-archived session. Settings toggle added.

### Result
- `tsc --noEmit` clean; `vitest run` = **1586 passed (170 files)** (+9).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M78 — /commit, /tests & welcome-screen prompt library (forty-sixth analysis pass)

Comparative gap analysis vs Aider (TUI) and ChatGPT/Claude. Three gaps found
and implemented. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#357** `/commit [message]` — Aider-style. The app had a Git panel and an
  agent `git_commit` tool but no quick commit command. Added a `/commit` builtin
  that gathers unstaged + untracked files via `gitStatus`, generates a
  conventional commit message from `gitDiff` via the active model when none is
  supplied (streamed via `fetchOllamaChatStream`), then stages and commits.
  Refuses with no workspace, while generating, or on a clean tree.
- [x] **#358** WelcomeScreen surfaces the user's prompt library. The empty state
  showed four hardcoded starters and ignored saved prompts. Extended
  `WelcomeScreen` with a `prompts` prop; saved prompts are shown (clicking sends
  the body), falling back to the starters when the library is empty. App passes
  the user's `prompts`.
- [x] **#359** `/tests <command>` — Aider-style. Runs a test command via
  `runCliOnce`; on exit 0 reports "Tests passed" without sending to the model;
  on non-zero exit sends the output framed as failing tests to fix and banners
  the failure. Distinct from `/run` (which always sends output).

### Result
- `tsc --noEmit` clean; `vitest run` = **1600 passed (171 files)** (+14).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M79 — Keyboard parity: Tab-indent, approval & diff-review shortcuts (forty-seventh analysis pass)

Comparative gap analysis vs Codex GUI, Claude GUI and TUI agentic tools
(Aider, Claude Code). Three keyboard-interaction gaps found and implemented.
No merge to `master` — work stays on `macOS-10.15`.

- [x] **#360** Tab-to-indent in the chat composer. Codex, Claude and most TUIs
  let Tab insert spaces inside multi-line text. The composer's Tab was consumed
  only by autocomplete navigation, so Tab did nothing when suggestions were
  closed. Added a Tab/Shift+Tab handler that inserts/removes two spaces at the
  caret when no `@`/`#`/slash suggestions are open; caret position is restored
  via `setTimeout`.
- [x] **#361** Keyboard shortcuts for the CLI command approval modal. Codex and
  Claude GUIs let you approve/deny with the keyboard. The approval modal
  required mouse clicks. Added a `keydown` listener (active while
  `pendingApproval` is set): Enter = Allow Once, Escape = Deny, A = Always
  Allow (adds to `cliAllowlist` and persists). Enter is guarded when a
  `HTMLButtonElement` is focused.
- [x] **#362** Keyboard shortcuts for the diff-review modal. Codex and Claude
  GUIs let you accept/reject file edits with Enter/Escape. The diff-review
  modal required button clicks. Added a `keydown` listener: Enter = Accept
  (resolves with `mergedNewString`), Escape = Reject (resolves `false`). Enter
  is guarded when a button is focused.

### Result
- `tsc --noEmit` clean; `vitest run` = **1608 passed (172 files)** (+8).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M80 — File-tree wiring, sidebar DnD & /init command (forty-eighth analysis pass)

Comparative gap analysis vs Codex GUI, Claude GUI, ChatGPT and TUI agentic tools
(Aider). Three gaps found and implemented — one bug fix and two feature additions.
No merge to `master` — work stays on `macOS-10.15`.

- [x] **#363** File-tree click was unwired (bug). \`FileTreePanel\` dispatched a
  \`ollama-gui:select-file\` CustomEvent on file click but nothing in \`App.tsx\`
  listened for it — clicking a file did nothing. Added a \`useEffect\` that
  listens for the event, reads the file via \`readFile\`, and pins it into the
  chat context (same mechanism as \`/add\`). Directory entries are ignored.
  Relative paths are computed from the workspace root for the pin label.
- [x] **#364** Sidebar drag-and-drop to move conversations into folders. Codex,
  Claude and ChatGPT all support dragging sidebar conversations onto folders.
  The app only had the \`/folder\` slash command. Added \`draggable\` session
  rows that set \`text/session-id\` on drag start, and folder-chip drop targets
  (\`onDragOver\`/\`onDrop\`) that call \`moveToFolder\`. The "All" chip is also
  a drop target to unfile a conversation. A ring highlight indicates the active
  drop target.
- [x] **#365** \`/init\` slash command — Aider-style. The app reads
  \`AGENTS.md\`/\`CLAUDE.md\` for system-prompt injection but had no way to
  create one. \`/init\` lists the workspace root via \`listDir\`, streams a
  prompt to the active model asking it to produce a concise \`AGENTS.md\`
  (project summary, coding conventions, build/test commands, structure notes),
  writes the result via \`writeFile\`, and reloads project rules. Refuses with
  no workspace or while generating.

### Result
- \`tsc --noEmit\` clean; \`vitest run\` = **1614 passed (173 files)** (+6).
- No Rust changes this pass (\`cargo test --lib\` 87 passed / 1 ignored).

## M81 — Search highlighting, command palette completeness & token estimate (forty-ninth analysis pass)

Comparative gap analysis vs Codex GUI, Claude GUI, ChatGPT, and VS Code. Three
gaps found and implemented. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#366** Chat search term highlighting. `findMessageMatches` found matching
  messages and scrolled to them, but the search term was not highlighted within
  the message text. Added a `highlightChildren` utility that wraps matching
  substrings in `<mark>` elements, and a `highlightQuery` prop to
  `MarkdownMessage` that applies it via custom ReactMarkdown component
  overrides (`p`, `li`, `td`, `strong`, `em`, `h1`–`h4`). The raw view also
  highlights. Highlights clear when search is closed.
- [x] **#367** Command palette completeness. The palette had 11 actions; 12 more
  actions with keyboard shortcuts were missing (Toggle Theme, Toggle Zen Mode,
  Toggle Artifacts, Regenerate, Copy Last Reply, Scroll to Latest, Pin/Unpin,
  Next/Previous Conversation, Zoom In/Out/Reset). Added all to the
  `paletteCommands` array for discoverability.
- [x] **#368** Token estimate in the composer footer. The footer showed word and
  character counts but not an estimated token count. Imported `estimateTokens`
  (already available in `tokenEstimate.ts`) and appended `~N tokens` to the
  counter so users can gauge context-window usage before sending.

### Result
- `tsc --noEmit` clean; `vitest run` = **1621 passed (174 files)** (+7).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M82 — Clear-all pinned files, copy-diff button & /web command (fiftieth analysis pass)

Comparative gap analysis vs Codex GUI, Claude GUI, VS Code, Aider and Claude
Code. Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#369** Clear-all pinned files button. Each pinned file chip had an
  individual drop button but there was no way to clear all pinned context
  files at once. Added a "Clear all" button (visible when 2+ files are pinned)
  that calls `setPinnedFiles([])` and `savePinnedFiles([])`, with a status
  banner confirmation. Uses `onMouseDown` to preserve composer focus, matching
  the individual drop-button pattern.
- [x] **#370** Copy-diff button in DiffReviewModal. The diff-review modal
  showed file changes but had no clipboard interaction. Added a "Copy diff"
  button in the modal header that generates a unified-diff string
  (`--- a/path` / `+++ b/path` / `+` / `-` / ` ` prefixes) from the `diffLines`
  result and copies it via `navigator.clipboard.writeText`. Shows "✓ Copied"
  feedback for 1.5 s. For `write_file` edits, generates a diff against
  `/dev/null`.
- [x] **#371** `/web` slash command. Web search infrastructure (`webSearch` +
  `formatResultsAsContext`) existed for auto-search and as an agent tool, but
  there was no manual user-triggered search. Added `/web <query>` to
  `BUILTIN_COMMANDS` and handled it in the slash-dispatch: calls `webSearch`
  with `enabled: true`, formats results, sends them as a user message via
  `sendMessage`, and shows a status banner. Refuses with no query or while
  generating; reports when no results are found.

### Result
- `tsc --noEmit` clean; `vitest run` = **1628 passed (175 files)** (+7).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M83 — Artifacts shortcut, apply-code-to-file & Ctrl+Enter send (fifty-first analysis pass)

Comparative gap analysis vs Codex GUI, Claude GUI, VS Code, ChatGPT, and Slack.
Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#372** Keyboard shortcut for the artifacts panel + help overlay gaps.
  The artifacts panel had a toolbar button and command-palette entry but no
  dedicated keyboard shortcut. Added Ctrl+Shift+A in the main `handleKeyDown`
  handler. Also added `Toggle Artifacts` and `Tab Indent / Outdent` entries to
  the `?` help overlay shortcuts list (Tab-to-indent was added in M79 but was
  never listed). Added the `Ctrl+Shift+A` hint to the palette entry.
- [x] **#373** Apply code block to file. Code blocks in chat had Copy and
  word-wrap buttons but no way to write code directly to a file. Added an
  `onApplyCode` prop to `CodeBlock` and `MarkdownMessage`; the message
  rendering passes a callback that extracts a file path from the language tag
  (e.g. `ts:src/helper.ts`), prompts the user if no path is embedded, and
  writes via `writeFile`. The Apply button only renders when a workspace is
  open (the callback is `undefined` otherwise). Shows a status banner on
  success/failure.
- [x] **#374** Send on Ctrl+Enter option. The composer always sent on Enter
  with no way to swap. Added a `sendOnCtrlEnter` boolean persisted in
  localStorage (`ollama_gui_send_on_ctrl_enter`). When enabled, Enter inserts
  a newline and Ctrl/Cmd+Enter sends. A toggle is in the Settings overlay under
  Context Compaction. Default is `false` (Enter sends) — backward compatible.

### Result
- `tsc --noEmit` clean; `vitest run` = **1636 passed (176 files)** (+8).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M88 — Folder rename, drag-file-to-composer & /redo (fifty-sixth analysis pass)

Comparative gap analysis vs VS Code, Codex GUI, ChatGPT, Claude GUI and Aider.
Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#387** Rename folder. Folders could be created and deleted but not
  renamed. Added `renameFolder(id)` (prompts for a new name, upserts via
  `storage.saveFolder`) and a ✏️ button on each folder chip. Matches
  VS Code/ChatGPT/Codex folder rename.
- [x] **#388** Drag file from the file tree into the composer. The composer drop
  handler only accepted OS-dropped images and file-tree nodes were not draggable.
  Made file `TreeNode`s `draggable` (storing `text/file-path`/`text/file-name`)
  and extended `handleDrop` to dispatch `ollama-gui:select-file` so the existing
  App listener pins the file. Matches VS Code/Codex drag-into-prompt.
- [x] **#389** `/redo` slash command. `/undo` dropped the last exchange without
  storing it. Added a `redoStackRef`; `/undo` now pushes the removed exchange
  (messages + branch state), and `/redo` pops and restores it. Matches
  Aider/editor undo/redo pairing.

### Result
- `tsc --noEmit` clean; `vitest run` = **1663 passed (181 files)** (+4).
- No Rust changes this pass.

## M87 — File-tree context menu, /status & /save · /load snapshots (fifty-fifth analysis pass)

Comparative gap analysis vs VS Code, Codex GUI, Claude GUI, Claude Code and
Aider. Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#384** Right-click context menu on file-tree nodes. `FileTreePanel`
  exposed click-to-pin and a hover copy-path button but had no `onContextMenu`.
  Added `onContextMenu` to each `TreeNode` row and a `ContextMenu` instance at
  the panel level with Pin to chat (dispatches `ollama-gui:select-file`),
  Copy path (absolute) and Copy relative path (relative to the workspace root).
  Matches VS Code/Codex/Claude file-tree right-click.
- [x] **#385** `/status` slash command. Added `/status` to `BUILTIN_COMMANDS`
  and the `RunResult` union; handled in the slash-dispatch by composing one
  banner from `model`, `getActiveRoot()`, `ollamaConnected` and
  `messages.length`. Matches Claude Code `/status`.
- [x] **#386** `/save` & `/load` conversation snapshots. Added both commands;
  `/save [name]` writes the current conversation JSON to
  `<workspace>/.ollama-gui/sessions/<name>.json` via `writeFile`; `/load <name>`
  reads it back via `readFile`, parses with `parseSessionImport`, saves it as a
  new session and loads it. Both require an open workspace. Matches Aider
  `/save` `/load`.

### Result
- `tsc --noEmit` clean; `vitest run` = **1659 passed (180 files)** (+5).
- No Rust changes this pass.

## M86 — Sidebar context menu, /map & /memory commands + CI fixes (fifty-fourth analysis pass)

Comparative gap analysis vs Codex GUI, Claude GUI, ChatGPT, VS Code, Aider and
Claude Code. Three feature gaps found and implemented, plus three failing CI/CD
stages fixed. No merge to `master` — work stays on `macOS-10.15`.

- [x] **#381** Right-click context menu on sidebar session items. The sidebar
  exposed per-session actions (rename, pin, tag, archive, duplicate, delete) as
  hover icon buttons but had no `onContextMenu`. Added `onContextMenu` to each
  session row and a second `ContextMenu` instance wired to `startRename`,
  `togglePin`, `addTagToSession`, `toggleArchive`, `duplicateSession`,
  `deleteSession`. Matches Codex/Claude/ChatGPT/VS Code sidebar right-click.
- [x] **#382** `/map` repo-map slash command. Added `/map` to
  `BUILTIN_COMMANDS` and the `RunResult` union; handled in the slash-dispatch by
  reading `getActiveRoot()`, listing the root (and one nesting level) via
  `listDir`, and appending an assistant message with the tree, plus a status
  banner with the entry count. "No workspace open" when none is active. Matches
  Aider `/map`.
- [x] **#383** `/memory` slash command. Added `/memory`; handled by composing
  the memory block via `composeMemoryBlock(activeProjectId)` and showing it in a
  status banner with the entry count, or "No memory entries". Matches Claude
  Code `/memory`.

### CI/CD fixes
- `Build & Test` → `Run tests`: `modelPull.test.tsx` streaming tests timed out
  at the 5s default under CI load; raised to 15s.
- `security-audit` → `npm dependency audit`: switched to
  `npm audit --omit=dev --audit-level=high` (vite/vitest advisories are dev-only
  tooling that never ships); production surface reports 0 vulnerabilities.
- `e2e` → `Run Playwright E2E`: fixed strict-mode violations in
  `e2e/smoke.spec.ts` (scoped Settings button to `name: 'Open settings'`; scoped
  message text to `getByTestId('messages-container')`).
- Bumped workflow `node-version` 20 → 22 (Node 20 deprecated on runners).

### Result
- `tsc --noEmit` clean; `vitest run` = **1654 passed (179 files)** (+7).
- No Rust changes this pass.

## M85 — Right-click context menu, /cwd command & workspace sync (fifty-third analysis pass)

Comparative gap analysis vs Codex GUI, Claude GUI, VS Code, Aider and Claude
Code. Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#378** Right-click context menu on chat messages. The app exposed all
  per-message actions (copy, copy-as-markdown, copy-as-plain-text, regenerate,
  edit, delete, quote, toggle raw/rendered, speak) as individual hover-visible
  icon buttons, but had no `onContextMenu` anywhere. Added a reusable
  `ContextMenu` component (fixed-position, role="menu"/"menuitem") rendered
  on `onContextMenu` of each message bubble. It reuses the existing handlers,
  closes on outside mousedown / Escape / window scroll, and is keyboard
  accessible. Matches Codex/Claude/VS Code right-click menus.
- [x] **#379** `/cwd` slash command. No way to show or copy the active
  workspace root path. Added `/cwd` to `BUILTIN_COMMANDS` and the
  `RunResult` action union; handled it in the slash-dispatch by reading
  `getActiveRoot()` and showing the path in a status banner (copied to
  clipboard), or "No workspace open" when none is active. Matches Aider
  `/cwd` and Claude Code.
- [x] **#380** FileTreePanel workspace sync (bug fix). Activating a project
  called `setWorkspaceRoot` (fileTools only), which left the
  `ollama_gui_workspace` localStorage entry that `FileTreePanel` reads
  unchanged — so the tree kept showing the old workspace. App's project
  activation effect and the project folder-picker now call `openWorkspace`
  (which updates both fileTools root and localStorage).
  `openWorkspace`/`closeWorkspace` broadcast a `ollama-gui:workspace-changed`
  custom event; `FileTreePanel` listens for it and re-reads state.
  `closeWorkspace` also clears the in-process root via the new
  `clearWorkspaceRoot` for full consistency.

### Result
- `tsc --noEmit` clean; `vitest run` = **1647 passed (178 files)** (+6).
- No Rust changes this pass (`cargo test --lib` unchanged).

## M84 — /settings, /prompt preview & copy-path from file tree (fifty-second analysis pass)

Comparative gap analysis vs Codex GUI, Claude GUI, VS Code, Aider and Claude
Code. Three gaps found and implemented. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **#375** `/settings` slash command. Settings were only accessible via
  Ctrl+, or the command palette. Added `/settings` to `BUILTIN_COMMANDS` and
  handled it in the slash-dispatch: `setIsSettingsOpen(true)`. Matches Aider
  `/settings` and Claude Code `/config`.
- [x] **#376** `/prompt` composed system prompt preview. The `/system` command
  showed only the raw user-set prompt, not the full composed prompt (with
  AGENTS.md rules, project instructions, cross-session memory). Added `/prompt`
  to `BUILTIN_COMMANDS` and handled it: composes the prompt via
  `composeSystemPrompt` (same as `sendMessage`) and displays it in a
  dismissable overlay with a Copy button. Escape closes the overlay.
- [x] **#377** Copy-path from file tree. Clicking a file in the tree pins it
  into context (M80), but there was no way to just copy the path. Added a
  copy-path button (⧉, visible on hover) to each `TreeNode` in
  `FileTreePanel.tsx` that copies `entry.path` to the clipboard via
  `navigator.clipboard.writeText` without pinning.

### Result
- `tsc --noEmit` clean; `vitest run` = **1641 passed (177 files)** (+5).
- No Rust changes this pass (`cargo test --lib` 87 passed / 1 ignored).

## M89 — Agentic loop robustness & multi-file edit parity (fifty-seventh analysis pass)

Comparative gap analysis vs Codex CLI, Claude Code, Cursor and Aider. Baseline:
`tsc --noEmit` clean; `vitest run` = **1673 passed (182 files)** — no failing
functionality found. Three missing capabilities identified and implemented.
The `gh` CLI token is invalid (see `docs/ANALYSIS.md`), so issues are registered
locally here per the established precedent.

- [x] **#395** PostToolUse hooks (Claude Code parity). Only `PreToolUse` hooks
  existed (`toolHooks.ts`). Claude Code runs hooks *after* tool execution too
  (auto-format, notify, audit, redact). Added a parallel `PostToolUseHook`
  registry + `runPostToolUseHooks`, wired into `agent.ts` after
  `toolRegistry.executeToolCall`. A blocked post-hook replaces the result
  content with the reason; a `transform` post-hook rewrites the result content.
- [x] **#396** Tool-output truncation (Codex / Claude / Cursor parity). Tool
  results were pushed verbatim into the model context, so a large `cat`,
  test run, or `read_file` could blow the context window. Added
  `MAX_TOOL_OUTPUT_CHARS` (20 000) and `truncateToolContent`; the agent loop
  feeds the truncated copy to the model while the UI keeps the full output.
- [x] **#397** Multi-file `apply_patch` tool (Codex CLI parity). `apply_edit`
  only did one `old_string`/`new_string` per call. Codex's `apply_patch` applies
  many Add/Update/Delete file ops in one shot. Added a new `apply_patch` tool
  that takes an `operations` array (`update` / `create` / `delete`), routes
  each through `proposeEdit` for diff review, and a Rust `delete_file` command
  + frontend `deleteFile` helper for the delete op.

### Result
- `tsc --noEmit` clean; `vitest run` = **1689 passed (184 files)** (+16 new).
- `cargo check` clean (new `delete_file` Tauri command registered); no Rust
  test regressions.
- 16 new tests: `m89agentHooksTruncation.test.ts` (11 — hook lifecycle,
  redact, block/transform, truncation unit + agent-loop integration) and
  `applyPatch.test.ts` (5 — multi-op apply, delete-error, diff-review routing,
  unknown-op).

## M90 — Agentic step progress & per-tool enable/disable (fifty-eighth analysis pass)

Comparative gap analysis vs Codex CLI, Claude Code, Cursor and Aider. Baseline:
`tsc --noEmit` clean; `vitest run` = **1689 passed (184 files)** — no failing
functionality. Two missing capabilities identified and implemented.

- [x] **#398** Agentic step/iteration progress (Codex CLI / Claude Code parity).
  The agent loop tracked an internal `iteration` counter but never surfaced it;
  the header status badge only showed "Thinking…" / "Running: <tool>". Codex CLI
  and Claude Code show live step progress (e.g. "Step 3/20"). Added an
  `onIteration(iteration, maxIterations)` callback to `AgenticChatOptions`,
  fired at the top of each loop iteration, and render "Step N/M" in the header
  agent-status badge during agentic generation.
- [x] **#399** Per-tool enable/disable with persisted selection (Claude Code
  parity). Every registered built-in tool was always exposed to the main agent;
  only MCP tools had per-tool toggles. Claude Code lets you disable individual
  tools. Added a `toolConfig` service (`loadDisabledTools` / `saveDisabledTools`
  / `getEnabledToolFilter` / `setToolEnabled`, persisted to localStorage), wired
  a conditional `toolFilter` into the main agentic call (only when some tool is
  disabled, so default behaviour is unchanged), a `/tools` slash command that
  lists registered tools with on/off state, and a Settings "Tools" section with
  a toggle per built-in tool.

### Result
- `tsc --noEmit` clean; `vitest run` = **1704 passed (189 files)** (+15 new).
- 15 new tests: `agentIteration.test.ts` (3 — onIteration firing per turn,
  across tool calls, capped at maxIterations), `toolConfig.test.ts` (8 —
  persistence, filter derivation, statuses), `toolsCommand.test.tsx` (2 —
  /tools parse + banner), `agentStepProgress.test.tsx` (1 — header "Step N/M"),
  `toolToggleSettings.test.tsx` (1 — settings toggle persists disabled state).
- Integrated the enable/disable toggle into the existing "Available Tools"
  settings listing (no duplicate card) to keep `e2e.test.tsx` assertions green.

## M91 — Combined batch diff review for multi-file apply_patch (fifty-ninth analysis pass)

Comparative gap analysis vs Codex GUI, Cursor and Claude Code. Baseline:
`tsc --noEmit` clean; `vitest run` = **1704 passed (189 files)** — no failing
functionality. One missing UX capability identified and implemented.

- [x] **#400** Combined batch diff review for multi-file `apply_patch` (Codex
  GUI / Cursor parity). When `apply_patch` carried several file operations, the
  diff-review modal popped up once per op (sequential single-file reviews).
  Codex GUI and Cursor show every file change from one patch in a single review
  with Accept All / Reject All + per-file accept. Added a batch review path:
  `proposeEdits(edits[])` + `setBatchReviewCallback` in `diffReview.ts`, the
  `apply_patch` tool routes all update/create ops through one batch review when
  there is more than one, and a new `DiffReviewBatchModal` presents the whole
  patch with per-file Accept/Reject, Accept All / Reject All, and keyboard
  shortcuts (Enter = accept all, Escape = reject all). Single-op patches keep
  the existing single-edit flow unchanged.

### Result
- `tsc --noEmit` clean; `vitest run` = **1717 passed (192 files)** (+13 new).
- 13 new tests: `diffReviewBatch.test.ts` (4 — no-callback apply all, batch
  callback per-edit decisions, single-callback fallback), `applyPatchBatch.test.ts`
  (3 — one batch review for N ops, per-file reject mapping, deletes alongside),
  `DiffReviewBatchModal.test.tsx` (6 — file list, Apply/Reject, Accept/Reject all,
  per-file toggle, Escape).
- Fixed a misplaced top-level `useEffect` (from the batch-callback wiring) that
  broke module load for every App-importing test; moved it into the App unmount
  cleanup effect and relocated a hoisted-but-misplaced `toolConfig` import.

## M92 — Auto-commit after agentic edits (Aider parity) (sixtieth analysis pass)

Comparative gap analysis vs Aider, Claude Code and Codex. Baseline:
`tsc --noEmit` clean; `vitest run` = **1717 passed (192 files)** — no failing
functionality. One missing capability identified and implemented.

- [x] **#401** Auto-commit after agentic edits (Aider parity). Aider auto-commits
  each edit with a descriptive message so changes are trivially revertible; the
  project had manual git tools and checkpoints/rewind but no auto-commit. Added
  an opt-in `autoCommitEdits` setting (persisted), an `autoCommit` service that
  stages + commits the edited file to the workspace git repo
  (`git_stage` + `git_commit`) with a `ollama-gui: <label> — <path>` message, an
  `EditAppliedCallback` in `diffReview.ts` fired after every successful
  `proposeEdit` / `proposeEdits` / `acceptEdit` apply, and an "Auto-commit edits"
  toggle in Settings. Disabled by default; degrades gracefully (no workspace,
  not a git repo, or git failure → non-fatal, no commit).

### Result
- `tsc --noEmit` clean; `vitest run` = **1729 passed (195 files)** (+12 new).
- 12 new tests: `autoCommit.test.ts` (8 — setting round-trip, commit message,
  disabled no-op, stage+commit, no-workspace error, git-failure error),
  `diffReviewEditApplied.test.ts` (3 — callback fires on apply, not on reject,
  per-edit in batch), `autoCommitSettings.test.tsx` (1 — toggle persists).
- Fixed a misplaced top-level `useEffect`/`setEditAppliedCallback` from the
  wiring (same class of bug as M91) that would have broken module load; moved
  the cleanup into the App unmount effect.

## M93 — /gitundo revert last agent auto-commit (Aider /undo parity) (sixty-first analysis pass)

Comparative gap analysis vs Aider, Claude Code and Codex. Baseline:
`tsc --noEmit` clean; `vitest run` = **1729 passed (195 files)** — no failing
functionality. One missing capability identified and implemented (companion to
M92 auto-commit).

- [x] **#402** `/gitundo` reverts the most recent agent auto-commit (Aider `/undo`
  parity). Aider's `/undo` reverts the last edit/commit; the project had
  `/undo` (drop last exchange) and checkpoints/rewind but no way to revert an
  agent auto-commit. Added a Rust `git_reset` command (hard-reset `HEAD~n`,
  scoped to the workspace cwd), a `gitReset` frontend helper, an
  `undoLastAutoCommit()` service that hard-resets `HEAD~1` only when the last
  commit subject starts with the `ollama-gui:` auto-commit prefix (refuses to
  touch user commits), and a `/gitundo` slash command that shows a result banner.
  Degrades gracefully (no workspace, no commits, git failure → non-fatal).

### Result
- `tsc --noEmit` clean; `cargo check` clean (new `git_reset` Tauri command
  registered); `vitest run` = **1739 passed (197 files)** (+10 new).
- 10 new tests: `autoCommitUndo.test.ts` (6 — no-workspace, reset on auto-commit,
  refuse on user commit, empty log, git failure, prefix), `gitUndoCommand.test.tsx`
  (4 — gitReset invoke args/default n, /gitundo parse, banner appears).

## M94 — Agentic "Continue" past max-iterations (Codex / Claude parity) (sixty-second analysis pass)

Comparative gap analysis vs Codex CLI, Claude Code and Cursor. Baseline:
`tsc --noEmit` clean; `vitest run` = **1739 passed (197 files)**. Codex and
Claude both let the user resume an agent run that stopped at the iteration
cap without re-typing the prompt; the project had the max-iterations stop
warning but no way to continue.

- [x] **#403** "Continue agent" past max-iterations. When the agentic loop
  exhausts `maxIterations` without a final answer, the stop warning is now
  surfaced to the UI (the generator yields it directly, bypassing
  `onAssistantMessage`, so the `for await` loop appends it to `messages`) and
  a `▶ Continue agent` button renders under the warning. Clicking it re-runs
  the agentic turn with the current context (no new user message) via
  `sendMessage(undefined, undefined, true)`. `onMaxIterations` sets the
  `agentHitMax` flag, which is intentionally NOT reset by `onComplete` (it is
  cleared on the next send) so the button persists after the run ends.

### Result
- `tsc --noEmit` clean; `vitest run` = **1742 passed (199 files)** (+3 new).
- 3 new tests: `agentMaxIterations.test.ts` (2 — `onMaxIterations` fires once
  at the cap and not on a normal final answer), `agentContinue.test.tsx` (1 —
  the Continue agent button appears after a max-iterations stop and clicking
  it re-invokes the agentic stream).

## M95 — secrets.ts keychain wrapper ref-tracker tests (sixty-third analysis pass)

Reconciled the stale top-of-file checklist (#224/#225/#226/#227/#228 were all
already implemented in earlier milestones but still marked `[ ]`): all five
now `[x]`.

- [x] **#404** `secrets.ts` keychain wrapper unit tests. The earlier #225 work
  covered `secretStore.ts` (the in-memory fallback path) via
  `secretStoreTauri.test.ts`, but the separate `secrets.ts` wrapper — which
  maps `secretSet/Get/Delete` to the Tauri `secret_set/get/delete` commands
  and tracks `(service, key)` refs in localStorage so the Settings UI can list
  what exists (values are never persisted) — had no direct test. Added
  `secrets.test.ts` (8 tests): invoke arg mapping, ref tracking + dedupe,
  null/undefined handling, delete removes the ref, empty list, localStorage
  corruption resilience, and a full set/get/delete round-trip through a
  mocked keychain.

### Result
- `tsc --noEmit` clean; `vitest run` = **1750 passed (200 files)** (+8 new).
- 8 new tests: `secrets.test.ts` (8).

## M96 — Agentic clean abort / cancel-keep-partial (Codex/Claude parity) (sixty-fourth analysis pass)

Comparative gap analysis vs Codex CLI, Claude Code and the normal streaming
path. Baseline: `tsc --noEmit` clean; `vitest run` = **1750 passed (200 files)**.

**Failing functionality found**: in agentic mode, aborting a run mid-fetch
(Esc / Stop) surfaced an `Error: aborted` banner via `onError` instead of a
clean cancellation. The normal streaming path already handled abort cleanly
(`#257`/`#303`), but the agentic loop's outer `catch` did not distinguish an
`AbortError` from a real error — a user-initiated Stop looked like a failure.

- [x] **#405** Agentic cancel-keep-partial. Added an `onCancel` callback to
  `AgenticChatOptions`; the loop's outer catch now classifies an abort
  (`signal.aborted`, `error.name === 'AbortError'`, or an `abort`-ish
  message — without gating on `instanceof Error`, since jsdom `DOMException`
  is not always an `Error` instance) and breaks silently via `onCancel`
  instead of `onError`. App wires `onCancel` to append `*(generation
  cancelled)*` + `wasCancelled: true` to the partial assistant reply, matching
  the normal streaming cancel-keep-partial affordance. A non-abort fetch error
  still fires `onError` with the error message.

### Result
- `tsc --noEmit` clean; `vitest run` = **1754 passed (202 files)** (+4 new).
- 4 new tests: `agentAbort.test.ts` (3 — mid-fetch abort fires `onCancel` not
  `onError` with no error message; already-aborted signal breaks pre-fetch with
  no callbacks; non-abort error still fires `onError`), `agentCancel.test.tsx`
  (1 — Stop during an agentic run marks the partial reply cancelled and shows
  no error banner).

## M97 — Tool approval "Allow for session" (Codex/Claude "don't ask again" parity) (sixty-fifth analysis pass)

Comparative gap analysis vs Codex CLI and Claude Code approval affordances.
Baseline: `tsc --noEmit` clean; `vitest run` = **1754 passed (202 files)**.

**Missing functionality found**: the CLI command approval modal already had an
"Always Allow" session-allowlist (`cliAllowlist`, #361), but the general agent
tool approval modal (plan/ask autonomy, `pendingToolApproval`) only exposed
Deny / Allow. Codex CLI's approval prompt offers "Yes, and don't ask again"
and Claude Code offers an equivalent session-scoped auto-approve — the GUI
lacked it for non-CLI tools.

- [x] **#406** "Allow for session" in the tool approval modal. Added a
  session-only `sessionToolAllowlistRef` (a `Set<string>`, not persisted —
  resets on reload, matching `cliAllowlist`). `onApprovalNeeded` now
  auto-resolves `true` without showing the modal when the tool is already in
  the allowlist, and the modal gains an "Allow for session" button that adds
  the tool and approves. Read-only/smart-approve behaviour is unchanged.

### Result
- `tsc --noEmit` clean; `vitest run` = **1755 passed (203 files)** (+1 new).
- 1 new test: `agentApprovalSession.test.tsx` (1 — in ask mode, approving a
  mutating tool "for session" auto-approves a subsequent call to the same tool
  without re-prompting, and the run completes with the final answer).

## M98 — Tool approval keyboard shortcuts + Escape-no-abort fix (Codex/Claude parity) (sixty-sixth analysis pass)

Comparative gap analysis vs Codex CLI and Claude Code approval affordances.
Baseline: `tsc --noEmit` clean; `vitest run` = **1755 passed (203 files)**.

**Failing functionality found**: the CLI command approval modal already had
keyboard shortcuts (#361: Escape=Deny, Enter=Allow, A=Always Allow), but the
general agent tool approval modal had none — only the Deny/Allow/Allow-for-
session buttons. Worse, pressing Escape while the tool approval modal was open
hit the global "Escape cancels generation" handler (#257) and aborted the run,
leaving the pending approval promise unresolved and the modal dangling.

- [x] **#407** Tool approval keyboard shortcuts + Escape guard. Added a
  dedicated keydown effect for `pendingToolApproval` (Escape=Deny,
  Enter=Allow, A=Allow for session — mirroring the CLI modal #361), and added
  `!pendingToolApproval && !pendingApproval` to the global Escape-abort guard
  so Escape now denies the tool instead of aborting the whole run (also fixes
  the latent CLI-approval double-action where Escape both denied and aborted).

### Result
- `tsc --noEmit` clean; `vitest run` = **1757 passed (203 files)** (+2 new).
- 2 new tests in `agentApprovalSession.test.tsx` (Escape denies and the run
  continues to a final answer; "A" approves for session and auto-approves the
  next call to the same tool).

## M99 — Plan-mode gating: approve plan before execution (Codex/Claude parity) (sixty-seventh analysis pass)

Comparative gap analysis vs Codex CLI and Claude Code plan mode. Baseline:
`tsc --noEmit` clean; `vitest run` = **1757 passed (203 files)**.

**Missing functionality found**: `isPlanMode()` was defined but never called.
The "plan" autonomy level was documented as "agent proposes a plan first;
executes only after approval", but in practice it behaved like "ask" mode + the
plan panel — mutating tools prompted per-call, with no distinct "approve the
plan, then execution begins" gate. Codex/Claude plan mode lets the agent
publish a plan (read-only), then blocks mutating tools until the user approves
the plan, after which the plan executes without per-tool prompts.

- [x] **#408** Plan-mode gating. Added a `planApprovedRef` + `pendingPlanApproval`
  modal. `onApprovalNeeded` now: in plan mode with the plan un-approved, shows a
  plan-approval modal (with the published plan steps) instead of the per-tool
  modal; in plan mode after approval, auto-approves mutating tools for the rest
  of the run. Read-only tools (incl. `update_plan`) still run freely during
  planning. `planApprovedRef` resets each run. The modal supports Approve/Deny
  buttons and keyboard shortcuts (Enter = Approve, Escape = Deny); the global
  Escape-abort guard no longer fires while the plan modal is open.

### Result
- `tsc --noEmit` clean; `vitest run` = **1759 passed (204 files)** (+2 new).
- 2 new tests: `agentPlanMode.test.tsx` (2 — mutating tools blocked until plan
  approval, then auto-approved for the run; Deny blocks the tool and keeps the
  plan un-approved).

## M100 — Plan edit-before-approve (Codex plan-edit parity) (sixty-eighth analysis pass)

Comparative gap analysis vs Codex CLI plan mode. Baseline: `tsc --noEmit` clean;
`vitest run` = **1759 passed (204 files)**.

- [x] **#409** Edit plan before approval. The plan-approval modal (M99/#408)
  now has an "Edit plan" toggle that turns the published step list into
  editable textareas; on Approve the edited steps are persisted to the plan
  store (statuses preserved) and rendered in the `PlanPanel`. Codex CLI lets
  the user edit a proposed plan before approving it; the GUI now matches.

### Result
- `tsc --noEmit` clean; `vitest run` = **1760 passed (204 files)** (+1 new).
- 1 new test in `agentPlanMode.test.tsx` (1 — edit a step before approving and
  the edited step replaces the original in the plan panel).

## M101 — Cancel unblocks approval-waiting runs (failing functionality) (sixty-ninth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1760 passed (204 files)**.

**Failing functionality found**: `cancelStream` only aborted the `AbortController`.
When the agent was blocked on an approval prompt (CLI command #361, agent tool
#88, or the new plan approval #408), the awaited approval promise never
resolved, so the loop hung — `isLoading` stayed true, the modal stayed open, and
the Stop button appeared to do nothing.

- [x] **#410** `cancelStream` now denies any pending approval (`pendingApproval`,
  `pendingToolApproval`, `pendingPlanApproval`), closes the modal, and resets
  `isLoading`/`agentStatus`/`agentStep`. Denying unblocks the loop, which then
  hits its top-of-iteration abort guard and completes cleanly via `onComplete`
  (no extra fetch). Applies to all three approval modal types.

### Result
- `tsc --noEmit` clean; `vitest run` = **1761 passed (204 files)** (+1 new).
- 1 new test in `agentPlanMode.test.tsx` (1 — Stop during a plan-approval wait
  closes the modal and ends generation without hanging, with no extra fetch).

## M102 — systemPrompt + structuredOutput unit tests (AGENTS.md coverage) (seventieth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1761 passed (204 files)**.

**Missing test coverage found**: two core, every-send service modules had no
direct tests (AGENTS.md requires every feature to have a test):
- `systemPrompt.ts` — `composeSystemPrompt` stacks rules → instructions →
  memory → base prompt; untested.
- `structuredOutput.ts` — `parseSchemaInput`, `tryParseJson`,
  `validateAgainstSchema` (lightweight JSON-Schema conformance), and
  `classifyResponse` (UI badge); untested.

- [x] **#411** Added `systemPrompt.test.ts` (5 — ordering, empty-source
  skipping, trimming, memory-as-is, base-only) and `structuredOutput.test.ts`
  (15 — schema parsing/empty/rejections, JSON parse, conformance for
  required/type/integer/array-items/null, and response classification).

### Result
- `tsc --noEmit` clean; `vitest run` = **1781 passed (206 files)** (+20 new).

## M103 — mcpConfig store unit tests (security-sensitive coverage) (seventy-first analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1781 passed (206 files)**.

**Missing test coverage found**: `mcpConfig.ts` (`mcpConfigStore`) had no direct
tests. It is security-sensitive — secret env VALUES must never persist to
localStorage (only blanked keys), with values stored in the OS keychain and
rehydrated on connect — and it drives auto-reconnect (#55). AGENTS.md requires
tests for security-sensitive code and Ollama/API error handling.

- [x] **#412** Added `mcpConfig.test.ts` (12): save() blanks env values in
  localStorage while storing secrets in the keychain; list() doesn't leak
  secrets and resets runtime state; loadSecrets() rehydrates from the keychain
  (and {} for unknown); delete() purges config + env + token secrets; in-place
  update by id; empty env values not stored; reconnectCandidates() filters
  http+lastConnected only; markConnected() records timestamp (no-op for
  unknown); generateId() uniqueness.

### Result
- `tsc --noEmit` clean; `vitest run` = **1793 passed (207 files)** (+12 new).

## M104 — MCP preset catalog integrity tests (seventy-second analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1793 passed (207 files)**.

**Missing test coverage found**: `mcpPresets.ts` (the curated one-click-setup
catalog) had no tests. A malformed/colliding entry would silently break the
"Add MCP server" form pre-fill.

- [x] **#413** Added `mcpPresets.test.ts` (9): non-empty catalog; unique keys;
  every preset has name/description/icon/docsUrl; transport type + command or
  url; deprecated presets/variants carry a securityNote; unique variant labels
  per preset; getMcpPreset find-by-key + undefined for unknown; secret env
  fields are flagged and well-formed.

### Result
- `tsc --noEmit` clean; `vitest run` = **1802 passed (208 files)** (+9 new).

## M105 — KnowledgeDB in-memory store unit tests (seventy-third analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1802 passed (208 files)**.

**Missing test coverage found**: `db.ts` (`createMemoryKnowledgeDB`, the
test/SSR implementation of the knowledge collection + file store consumed by
`rag.ts`/`knowledge.ts`) had no direct tests.

- [x] **#414** Added `db.test.ts` (10): empty start; collection save/get/upsert/
  delete; file put/get (preserving text+chunks)/undefined-for-unknown;
  getFilesByCollection filtering; deleteFile targeting; deleteFilesByCollection
  scope; per-instance independence.

### Result
- `tsc --noEmit` clean; `vitest run` = **1812 passed (209 files)** (+10 new).

## M106 — LibreOffice onboarding persistence tests (seventy-fourth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1812 passed (209 files)**.

**Missing test coverage found**: `libreOfficeOnboarding.ts` (localStorage-backed
state for the optional LibreOffice conversion-engine onboarding modal, #145)
had no tests despite exposing a `_store` storage seam intended for testing.

- [x] **#415** Added `libreOfficeOnboarding.test.ts` (9): default state;
  save/load round-trip; markDismissed preserves path; setLoPath records;
  empty-path dropped; corrupted-JSON resilience; needsOnboarding gating
  (available / unavailable+not-dismissed / dismissed).

### Result
- `tsc --noEmit` clean; `vitest run` = **1821 passed (210 files)** (+9 new).

## M107 — MCP pure helpers + server-manager registry tests (seventy-fifth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1821 passed (210 files)**.

**Missing test coverage found**: `mcp.ts`'s pure helper `normalizeToolsList`
and the non-connecting `McpServerManager` registry methods had no direct tests
(transport-dependent paths are covered in `mcp-transport.test.ts`; the
manager's add/get/remove/active-id methods are transport-free but untested).

- [x] **#416** Added `mcp.test.ts` (12): `normalizeToolsList` — {tools:[]}/bare
  array, inputSchema→parameters, description+parameter defaults, parameters
  fallback, empty/missing results; `McpServerManager` — add/get/getAll/upsert,
  remove (no active connection), empty active ids, unknown-server connect
  throws.

### Result
- `tsc --noEmit` clean; `vitest run` = **1833 passed (211 files)** (+12 new).

## M108 — Message queue UI tests (#137 coverage) (seventy-sixth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` green.

**Missing test coverage found**: the message queue (#137 — submissions while a
reply streams are enqueued as "queued" chips and auto-sent FIFO on completion)
had no tests.

- [x] **#417** Added `messageQueue.test.tsx` (2): while a turn streams, pressing
  Enter enqueues the prompt (a "queued" chip appears) and it auto-sends once
  the active turn completes; a queued message can be removed before it is sent
  (and releasing the active turn does not then auto-send it).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` green (0 failures; +2 new tests).
  (The exact passed count fluctuates ±1 run-to-run due to a pre-existing flaky
  timing test in `e2e.test.tsx`'s MCP-connection case — unrelated to this change.)

## M109 — Continue-generation click + regenerate-with-model UI tests (seventy-seventh analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` green.

**Missing test coverage found**: two existing per-message affordances had no
behavioral tests:
- Continue generation on a cancelled reply (#303) — only tested that the button
  *appears*, not that clicking it resumes.
- Regenerate with a different model (#270) — the ↺▾ model menu was untested.

- [x] **#418** Added a test in `continueExportCompact.test.tsx`: clicking
  "Continue generation" on a seeded cancelled reply appends the streamed
  continuation and clears the `*(generation cancelled)*` note.
- [x] **#419** Added `regenerateWithModel.test.tsx`: the ↺▾ menu lists models in
  a `role=listbox`; picking one regenerates that reply with the selected model
  (the regeneration request body carries the chosen model, distinct from the
  first reply's model).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` green (0 failures; +2 new tests).
  (Passed-count fluctuates ±a few run-to-run due to a pre-existing flaky timing
  case in `e2e.test.tsx`'s MCP-connection test — unrelated to these changes.)

## M110 — Prompt history recall UI tests (#332 coverage) (seventy-eighth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` green.

**Missing test coverage found**: prompt history recall (#332 — Alt+Up/Alt+Down
in the composer walks back/forward through sent prompts) had no tests.

- [x] **#420** Added `promptHistory.test.tsx` (2): Alt+Up recalls prompts
  most-recent-first, Alt+Down moves forward and clears past the end; slash
  commands are not recorded into history (Alt+Up is a no-op after a /help).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1835 passed (212 files)** (+2).

## M111 — Up-arrow quick-edit last user message UI tests (#267 coverage) (seventy-ninth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` green.

**Missing test coverage found**: the Up-arrow quick-edit affordance (#267 —
ArrowUp in an empty composer opens inline edit on the last user message,
ChatGPT/Cursor parity) had no tests.

- [x] **#421** Added `upArrowEdit.test.tsx` (2): ArrowUp opens inline edit
  pre-filled with the last user prompt and submitting "Send edit" re-sends the
  edited text; ArrowUp is ignored while a generation is in progress.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` green (0 failures; +2 new tests).
  (Passed-count fluctuates run-to-run due to a pre-existing flaky timing case
  in `e2e.test.tsx`'s MCP-connection test — unrelated to these changes.)

## M112 — Scroll-to-bottom button click→scroll UI test (#255/#258 coverage) (eightieth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` green.

**Missing test coverage found**: the ANALYSIS noted the scroll-to-bottom button's
appearance/disappearance was tested but its click→scroll behavior was not.

- [x] **#422** Added `scrollButton.test.tsx` (1): simulating a scrolled-up
  messages container makes the "Scroll to bottom" button appear; clicking it
  calls `scrollIntoView` on the end sentinel and hides the button.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1836 passed (213 files)** (+1).

## M113 — Disabled-tool execution enforcement (#423, failing functionality) (eighty-first analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` green.

**Failing functionality found**: per-tool enable/disable (#399) only removed a
tool from the request payload (`toolFilter`), but the agentic loop executed tool
calls via `toolRegistry.getTool` against the full registry. If the model
returned a call to a disabled tool (e.g. a hallucination, or a stale context),
the disabled tool would still run — the disable was advisory, not enforced.

- [x] **#423** Enforce `toolFilter` at execution time in `agenticChatStream`:
  when a `toolFilter` is active and the called tool's name is not in it, the
  loop blocks it with a `Tool blocked: '<name>' is disabled by the user.`
  result (fed back to the model) instead of executing. Tools in the filter and
  the no-filter (all-tools) path are unchanged.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1839 passed (214 files)** (+3).
- 3 new tests: `agentDisabledTool.test.ts` (3 — disabled tool blocked, enabled
  tool executes, no-filter allows all).
- Note: a pre-existing flaky timing case in `e2e.test.tsx`'s MCP-connection test
  fails intermittently (unrelated to this change; left untouched per scope).

## M114 — Many-models fan-out tests (#126 / #424, missing test coverage) (eighty-second analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1823 passed (213 files)** (stable; the handoff's 1839 was a fluke-high fluctuation from pre-existing flaky timing tests).

**Missing test coverage found**: `src-frontend/services/manyModels.ts` (#126)
implements the many-models fan-out (send one prompt to 2–3 models, render
sibling replies). `rg` for `runManyModels`/`ModelGroup`/`extraModels` in
`test/` returned no matches — the module was entirely untested. The pure
helpers `hasSameHostConflict` and `groupByHost` and the injected-stream
`runManyModels` orchestrator are transport-free and directly testable without
real `fetch`.

- [x] **#424** Add `src-frontend/test/manyModels.test.ts` covering:
  - `hasSameHostConflict`: two default-host locals → true; two distinct
    connections → false; mixed → false; single model → false; trailing-slash
    host normalisation.
  - `groupByHost`: default-host models grouped together; connected models split
    by connection `baseUrl`; order preserved within a batch.
  - `runManyModels`: streaming→done updates per model + chunk aggregation;
    same-host models run sequentially (call order preserved); different-host
    batches overlap (parallel); abort signal breaks the sequential batch;
    stream error surfaced as state `error`; OpenAI-kind connected models routed
    through `streamOpenAi` (with reasoning passthrough).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1837 passed (214 files)** (+14 over the 1823 baseline). Verified isolated: a no-manyModels run diffs by exactly the one new file.
- 14 new tests in `manyModels.test.ts` (5 + 3 + 6 across the three suites).

## M115 — Stabilise flaky CLI approval keyboard tests (#425, failing test infra) (eighty-third analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1837 passed (214 files)** (incl. M114).

**Failing functionality found (test infrastructure)**: the three CLI-approval
keyboard-shortcut UI tests in `m79KeyboardParity.test.tsx` (#361 — Enter, Escape,
A-always-approve) flaked ~20% of runs. Root cause: the approval keydown listener
is attached in a `useEffect` that runs AFTER the modal paints, but the test
fired `fireEvent.keyDown(window, …)` immediately after `getByText('Command
Approval Required')` resolved — i.e. before the effect ran. The keydown hit no
listener, the approval promise never resolved, and the test hung until the 5 s
vitest timeout. Reproduced: 1 failure in 5 isolated runs pre-fix.

- [x] **#425** Wrap each keydown dispatch in a `waitFor` that re-fires the event
  until the modal closes (listener-ready). Re-firing is safe: `resolve()` is
  idempotent on an already-settled promise and `cliAllowlist.add()` is idempotent.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1837 passed (214 files)** (no
  regression; the three tests now pass 8/8 isolated runs vs ~4/5 pre-fix).
- No production code changed — test-only race fix.

## M116 — Stabilise flaky MCP connection-error e2e test (#426, failing test infra) (eighty-fourth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1837 passed (214 files)** (incl. M115).

**Failing functionality found (test infrastructure)**: the e2e test "should
handle MCP connection errors" (`e2e.test.tsx`) was flaky and slow (5–8 s,
intermittent timeout). Root cause: the suite's `beforeEach` mocks
`global.fetch` to resolve `{ ok: true, json: () => ({ models: [] }) }` for
*every* URL. `McpHttpClient.connect()` POSTs an `initialize` request to the
server URL and treats `ok:true` + no `result.error` as a successful connect —
so with the blanket mock the "unreachable" `http://localhost:1` server
sometimes *connected* (green dot) instead of erroring. The test only asserted
"any coloured dot" (red/yellow/green), masking the wrong path, and the real
connect/listTools timing made it nondeterministic and slow.

- [x] **#426** Override `global.fetch` inside the test so the MCP server URL
  rejects with a `TypeError` (connection refused) while model-loading endpoints
  keep the safe default. `McpHttpClient.connect()` now throws deterministically
  → the Connect handler sets `status:'error'` → red dot. Tightened the assertion
  to the red (`.bg-red-400`) dot specifically, matching the test's intent.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1837 passed (214 files)**.
- Isolated runs: 5/5 green at ~1.8 s each (down from 5–8 s, no timeouts).
- No production code changed — test-only determinism fix.

## M117 — #file context ref always returned "(not yet indexed)" (#427, failing functionality) (eighty-fifth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1837 passed (214 files)**.

**Failing functionality found**: `resolveContextRef` for a `kind === 'file'`
`#`-command context reference (#119, Codex/Claude @-file parity) called
`retrieve([], query, k, opts)` — passing an **empty** collection-id list. The
`rag.retrieve` implementation iterates `for (const collectionId of
collectionIds)`, so `[]` yields zero chunks and returns `[]`. The subsequent
`chunks.filter(c => c.fileId === ref.id)` was therefore always empty, and every
`#file` reference fell through to the useless `"(file not yet indexed)"`
placeholder — **even for fully-indexed files**. The user's explicitly-referenced
file content was never injected into the agent's context. (No test covered the
file branch, so the bug was invisible.)

- [x] **#427** Fix `resolveContextRef` file branch to load the file record
  directly via `getKnowledgeDB().getFile(ref.id)` and return its extracted
  `text` (or concatenated `chunks`), capped at 20 000 chars (same cap as the URL
  branch). This matches @-file semantics ("inject THIS file's content"), not the
  old query-relevance-ranked subset that was both broken and semantically wrong
  for a specific file. Missing/empty file records still fall back to the
  placeholder.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1841 passed (214 files)** (+4).
- 4 new tests in `hashCommand.test.ts`: indexed file returns its text; fallback
  to concatenated chunks when `text` is absent; missing record → placeholder;
  20 000-char cap.

## M118 — @-mention token-boundary, $-content safety, subdir expansion (#428, failing + missing functionality) (eighty-sixth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1841 passed (214 files)** (incl. M117).

Three issues found in `atCommand.ts` (@-mention file context, #86 —
Codex/Claude/Cursor @-file parity):

**Failing functionality:**
1. `isAtTrigger` / `atQuery` used `/@\S*$/` with no token-boundary anchor, so an
   email address or mid-word `@` (e.g. `contact user@example.com`) opened the
   file picker — a false trigger Codex/Claude don't have.
2. `resolveAtMention` used `input.replace(/@\S*$/, block)` with a *string*
   replacement, so file content containing `$&`, `$1`, `$<name>` was interpreted
   as `String.replace` substitution patterns and mangled (e.g. `$&` re-inserted
   the matched `@mention` text into the injected file body).

**Missing functionality:**
3. `getAtOptions`' doc comment promised "Lists the root, then flat-maps one
   level of subdirectory contents", but the implementation listed **only the
   root** — nested files (`src/App.tsx`) were never @-mentionable, unlike
   Codex/Claude/Cursor which surface nested project files.

- [x] **#428** (1) Anchor `isAtTrigger`/`atQuery` to a token boundary
  (`(?:^|\s)@…`) so only start-of-input / post-whitespace `@` triggers.
  (2) Switch `resolveAtMention` to a function replacement
  `(_m, sep) => sep + block` that preserves leading whitespace and inserts file
  content literally. (3) Implement one-level subdir expansion in `getAtOptions`
  with dir-prefixed labels (`src/App.tsx`) for disambiguation.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1851 passed (214 files)** (+10).
- `atCommand.test.ts`: 16 → 26 tests — per-path `list_dir` mock; subdir entries
  with full paths; email/mid-word non-trigger; start-of-input trigger;
  `$&`/`$1` content inserted literally; leading-whitespace preservation.

## M119 — expandTemplate $-injection corruption + draft-persistence test flake (#429, #430) (eighty-seventh analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1851 passed (214 files)** (incl. M118).

**Failing functionality found:**
1. `commands.ts` `expandTemplate` (#96, slash-command prompt templates —
   Codex/Claude `/`-command parity) corrupted user arguments containing `$`:
   - `template.replace('$ARGUMENTS', args.trim())` used a *string* replacement,
     so `$&` in the args re-inserted the matched `'$ARGUMENTS'` text and `$5`
     became empty — e.g. `/translate The price is $5 and $&` produced
     "The price is and and $ARGUMENTS", destroying the user's literal text.
   - The `$1`…`$N` loop ran *after* `$ARGUMENTS` expansion, so any `$N` token
     inside the already-expanded argument text was re-substituted with the Nth
     word (e.g. `$5` in args was clobbered by the 5th word).

**Failing test infrastructure:**
2. `draftPersistence.test.tsx` (#273) timed out at the 5 s vitest test limit
   under full-suite parallel load (5.6 s; ~0.7 s in isolation) — a pre-existing
   timing flake unrelated to any production change.

- [x] **#429** Rewrite `expandTemplate` with function replacements (so `$` in
  args is inserted literally) and substitute `$1`…`$N` BEFORE `$ARGUMENTS` (so
  expanded argument text is not re-processed). Empty args no longer fabricate a
  spurious `$1` word.
- [x] **#430** Raise the draft-persistence test timeout to 15 s and its
  `waitFor` polls to 3 s so the full-App render + 3 session switches don't trip
  the default 5 s limit under load.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1855 passed (214 files)** (+4).
- 4 new tests in `commands.test.ts` (`$&`/`$N` literal preservation, no
  re-substitution, literal `$1` in a `$1` slot).

## M120 — ComfyUI image generation broken at /view binary fetch (#431, failing functionality) (eighty-eighth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1855 passed (214 files)**; `cargo test --lib` = 87 passed / 1 ignored.

**Failing functionality found**: `generateComfyUI` (#130, local image generation)
was broken at the image-retrieval step. After queuing a workflow and polling
`/history`, it fetched each generated image from `/view` via `httpRequest('GET',
…)`, which returns the body as a **text** string, then did
`btoa(imgResp.body)`. The ComfyUI `/view` endpoint returns a binary PNG. On the
Rust path, `mcp_http_request` reads the body with `response.text()` (lossy
UTF-8, replacing invalid bytes with U+FFFD); on the fetch fallback, `res.text()`
also decodes binary as UTF-8. `btoa()` then throws
`InvalidCharacterError: The string to be encoded contains characters outside of
the Latin1 range` (code points > 0xFF), so ComfyUI generation always failed when
an image was ready. The A1111 and DALL-E backends were unaffected (they return
base64 inline in JSON). The ComfyUI backend had **no test**.

- [x] **#431** (Rust) Add a `http_get_binary` Tauri command that fetches a URL
  and returns its body as `body_base64` (uses `response.bytes()` + standard
  base64), avoiding the lossy-text round-trip and CORS. Extracted a pure
  `bytes_to_base64` helper for unit testing. Registered in the invoke handler.
- [x] **#431** (TS) Add `httpGetBase64(url)` in `imagegen.ts` that routes through
  `http_get_binary` and falls back to a browser `fetch` → `Blob` →
  `FileReader.readAsDataURL` (strip data-URL prefix) in non-Tauri environments.
  `generateComfyUI` now uses it for the `/view` fetch instead of
  `httpRequest('GET', …)` + `btoa`.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1858 passed (214 files)** (+3);
  `cargo test --lib` = **89 passed / 0 failed / 1 ignored** (+2).
- 3 new TS tests in `imagegen.test.ts` (ComfyUI: binary base64 round-trip of the
  PNG signature; history polling until image appears; non-2xx queue error).
- 2 new cargo tests (`bytes_to_base64` PNG signature + empty/round-trip).

## M121 — rewind_checkpoint bypassed the diff-review approval gate (#432, failing functionality / safety) (eighty-ninth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1858 passed (214 files)**; `cargo test --lib` = 89 passed / 1 ignored.

**Failing functionality found (safety bypass)**: the `rewind_checkpoint` agent
tool (#91/#180, Codex/Claude checkpoint-rewind parity) restored files by calling
`writeFile(path, content)` **directly**. Every other write path
(`write_file`, `apply_edit`, `apply_patch`) routes through `proposeEdit` /
`proposeEdits` so the user reviews a diff before files change — but rewind
skipped that gate entirely. An autonomous agent could therefore overwrite
multiple files to a prior state with NO user review, contradicting the
review-every-write model the rest of the editor enforces. (`rewind_checkpoint`
was the only mutating tool that bypassed review; `git_reset` is user-initiated
via `/gitundo`, not an agent tool.) No test exercised the review interaction.

- [x] **#432** Route `rewindToCheckpoint` through `proposeEdits` (the same batch
  diff-review gate `apply_patch` uses). Autonomous / headless mode (no batch
  callback) still applies every edit immediately, so existing behaviour and the
  one-click rewind are unchanged; UI mode now surfaces the rewind as a batch
  review the user accepts/rejects per file.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1861 passed (214 files)** (+3).
- 3 new tests in `checkpoints.test.ts`: rejection blocks the restore (no
  bypass), acceptance restores, and no-callback autonomous mode is unchanged.

## M122 — Workspace RAG never indexed .env.example / multi-dot text files (#433, failing functionality) (ninetieth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1861 passed (214 files)**.

**Failing functionality found**: `workspaceRag.ts` `isTextFile` (#94, workspace
RAG — Codex/Claude repo-context parity) computed the extension as
`name.slice(name.lastIndexOf('.'))`. For a multi-dot / dotfile name like
`.env.example`, `lastIndexOf('.')` points at the dot before `example`, so the
extension became `.example` — which is NOT in `TEXT_EXTENSIONS`. The set
explicitly lists `.env.example` (and `.gitignore`), but those entries were
**dead**: `.env.example` template files were never indexed into the workspace
knowledge collection, so `queryWorkspace` could never surface them. (`gitignore`
matched only by luck — its single dot sits at index 0.)

- [x] **#433** `isTextFile` now checks the last extension AND, as a fallback, the
  whole lowercased filename against `TEXT_EXTENSIONS`, so dotfile / multi-dot
  entries (`.env.example`, `.gitignore`) match while real `.env` (secrets) and
  binary extensions still don't. Exported `isTextFile` for direct unit testing.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1867 passed (214 files)** (+6).
- 6 new tests in `workspaceRag.test.ts`: `.env.example` / `.gitignore` match;
  real `.env` excluded; `foo.test.ts` / `component.spec.jsx` match by last ext;
  non-text / unknown extensionless names rejected; end-to-end that a
  `.env.example` file is indexed and returned by `queryWorkspace`.

## M123 — Visual diff silently passed when screenshots failed to decode (#434, failing functionality) (ninety-first analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1867 passed (214 files)**.

**Failing functionality found**: `imageDiff.ts` `diffScreenshots` (#79, the
pixel-diff behind the `visual_match` browser-scenario step and the
`diff_screenshots` agent tool) returned `{ diffRatio: 0, pass: true, diffDataUrl:
'' }` when either screenshot failed to decode/load (`loadImageData` → null). So a
corrupt, empty, or unloadable base64 PNG silently **passed** visual regression —
the scenario step would report success even though no comparison actually
happened. (All existing tests used the `_mocks.diff` seam, so the real null path
was never exercised.)

- [x] **#434** Treat a decode/load failure as a FAILED diff
  (`{ diffRatio: 1, pass: false, diffDataUrl: '' }`), matching the existing
  size-mismatch semantics. Added a `_mocks.loadImageData` seam so the null path
  is unit-testable in jsdom (which has no canvas).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1869 passed (214 files)** (+2).
- 2 new tests: both-screenshots-fail → pass=false; only-before-fails → pass=false.

## M124 — MCP HTTP IPC deserialization broken (camelCase mismatch) (#435, failing functionality) (ninety-second analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1869 passed (214 files)**; `cargo test --lib` = 89 passed / 1 ignored.

**Failing functionality found**: `src-tauri/src/lib.rs` `McpHttpRequest` had
snake_case fields (`session_id`, `auth_token`) with **no**
`#[serde(rename_all = "camelCase")]`. Tauri v2 does NOT auto-camelCase nested
struct fields (only top-level command parameters), so every `mcp_http_request`
invoke that sent camelCase keys failed to deserialize:

- `mcp-http.ts:111` sends `sessionId` / `authToken` (camelCase) →
  `Err("missing field session_id")` → **all HTTP MCP servers broken in
  production** (the invoke rejects; mcp-http.ts has no fetch fallback, throws
  `MCP HTTP request failed`).
- `openapiTools.ts:135` and `imagegen.ts:67` call `mcp_http_request` with
  `{ method, url, headers, body }` — **no session_id at all** → same
  deserialize error → they fall back to browser `fetch` (CORS), so the "route
  through Rust to avoid CORS" claim was false for those.

- [x] **#435** Added `#[serde(rename_all = "camelCase")]` to `McpHttpRequest`
  and `#[serde(default)]` on `session_id: String` (callers that omit it now
  deserialize with `""`; the field is unused by the command body so defaulting
  is safe). `McpHttpResponse` left unchanged (all single-word fields).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1869 passed (214 files)** (0);
  `cargo test --lib` = **90 passed / 0 failed / 1 ignored** (+1).
- 1 new cargo test (`mcp_http_request_deserializes_camel_case_and_optional_session_id`)
  verifying all three call shapes (camelCase with session, camelCase without
  session, authToken present). No TS test added — the IPC path is only
  exercisable via real Tauri, not jsdom (tests mock `invoke`).

## M125 — MCP stdio transport silently ignored `success: false` from spawn (#436, failing functionality) (ninety-third analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1869 passed (214 files)**; `cargo test --lib` = 90 passed / 1 ignored.

**Failing functionality found**: `TauriMcpStdioTransport.spawnProcess`
(`mcp-tauri.ts`, #58 MCP stdio transport) called
`invoke('mcp_stdio_spawn', …)` and received `McpStdioResponse` but **never
checked `result.success`**. The Rust `mcp_stdio_spawn` returns
`Ok(McpStdioResponse { success: false, message: "Session already exists" })`
for soft failures (duplicate session) rather than an `Err`. Without the check,
the JS side silently proceeded to register the client and return as if the
spawn succeeded — subsequent `sendRequest` / `readResponse` calls would then
fail with confusing errors or `executeWithResponse` would time out, with no
indication that the spawn itself had failed. (All existing tests mocked
`spawnProcess` at the `spyOn` level, so the real invoke→response handling was
never exercised, and `mcp-tauri.ts` had **zero direct unit tests**.)

- [x] **#436** `spawnProcess` now checks `result?.success === false` and throws
  with the response `message` (falling back to `'unknown error'`). Added 15
  direct unit tests in `mcpTauri.test.ts` covering: spawn success/failure/env
  forwarding, sendRequest (not-found + success), readResponse (not-found +
  string + null), closeProcess (cleanup + error swallowing),
  checkProcessAlive (true + false), and executeWithResponse (response +
  timeout).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1884 passed (215 files)** (+15);
  `cargo test --lib` = 90 passed / 1 ignored (unchanged).

## M126 — openPreview left stale `_open` on IPC rejection + CliCommandRequest/Response camelCase (#437, failing functionality / safety) (ninety-fourth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1884 passed (215 files)**; `cargo test --lib` = 90 passed / 1 ignored.

**Failing functionality found (two issues)**:

1. **`openPreview` stale `_open` flag** (#172, browser preview): `openPreview`
   set `_open = true` optimistically before awaiting
   `preview_webview_open`. If the IPC rejected (e.g. no webview runtime, bad
   URL), `_open` stayed `true` even though the preview never opened.
   `navigatePreview` / `setBoundsPreview` / `reloadPreview` would then send
   commands to a non-existent webview (harmless but wasteful and confusing),
   and `isPreviewOpen()` would falsely report `true`.

2. **`CliCommandRequest` / `CliCommandResponse` snake_case mismatch** (latent):
   `run_cli_command` is registered in the Tauri handler but not yet called
   from JS. Its request struct has `timeout_ms` (snake_case) with no
   `rename_all`, so a future JS caller sending `timeoutMs` (camelCase) would
   silently get `None` (Option defaults). The response struct serializes
   `exit_code` / `timed_out` as snake_case, so JS reading `exitCode` /
   `timedOut` would get `undefined`. Same class of bug as #435 (M124).

- [x] **#437** `openPreview` now wraps the invoke in a try/catch: on rejection,
  `_open` is reset to `false` and the error is rethrown. The optimistic-set
  still works for pending (not-yet-resolved) invokes. Added
  `#[serde(rename_all = "camelCase")]` to both `CliCommandRequest` and
  `CliCommandResponse` as hardening.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1887 passed (215 files)** (+3);
  `cargo test --lib` = **91 passed / 0 failed / 1 ignored** (+1).
- 3 new TS tests (openPreview rejects → `_open=false`; navigate no-ops after
  rejected open; setBounds no-ops after rejected open). 1 new cargo test
  (`cli_command_request_response_camel_case_round_trip` verifying camelCase
  deserialization + serialization of both structs).

## M127 — Browser scenario click/type sent `ref_id` (snake_case) to Tauri (#438, failing functionality) (ninety-fifth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1887 passed (215 files)**; `cargo test --lib` = 91 passed / 1 ignored.

**Failing functionality found**: `scenario.ts` `executeStep` (#78, browser
scenario runner) called `cdpInvoke('browser_cdp_click', { ref_id: … })` and
`cdpInvoke('browser_cdp_type', { ref_id: …, text: … })` using the **snake_case**
key `ref_id`. Tauri v2 auto-camelCases top-level command parameters, so the Rust
`browser_cdp_click(ref_id: String)` expects the JS key `refId` (camelCase). With
`ref_id`, Tauri would not find the `refId` parameter and the command would
**reject in production** — **all click and type steps in browser scenarios were
broken**. (The sibling `browser-tools.ts` already used `refId` correctly; the
scenario runner was the only caller with the wrong casing. Existing tests mocked
`_mocks.invoke` and never asserted on the arg keys, so the bug was invisible.)

- [x] **#438** Changed both `browser_cdp_click` and `browser_cdp_type` invoke
  calls in `scenario.ts` to send `refId` (camelCase) instead of `ref_id`. The
  `step.args.refId ?? step.args.ref_id` fallback is preserved for legacy
  scenarios that store `ref_id` in their step args.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1890 passed (215 files)** (+3);
  `cargo test --lib` = 91 passed / 1 ignored (unchanged).
- 3 new tests in `scenario.test.ts`: click sends `refId` (not `ref_id`), type
  sends `refId` + `text`, and legacy `ref_id` arg is still forwarded as `refId`.

## M128 — terminal_run used `sh -c` on all platforms, broken on Windows (#439, failing functionality) (ninety-sixth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1890 passed (215 files)**; `cargo test --lib` = 91 passed / 1 ignored.

**Failing functionality found**: `terminal_run` (#62, streaming terminal
panel) hardcoded `std::process::Command::new("sh")` with no `#[cfg(windows)]`
branch. On Windows, `sh` is not in PATH (unless Git Bash / WSL is installed),
so every terminal command would fail with "No such file or directory". The
sibling `run_cli` command already had the correct `#[cfg(unix)]` → `sh -c` /
`#[cfg(windows)]` → `cmd /C` split; `terminal_run` was the only command-launch
path that missed it.

- [x] **#439** Added the same `#[cfg(unix)]` / `#[cfg(windows)]` split to
  `terminal_run` that `run_cli` uses. On Unix: `sh -c <command>`; on Windows:
  `cmd /C <command>`. The rest of the function (stdout/stderr piping, event
  emission, PID tracking) is unchanged.

### Result
- `npx tsc --noEmit` clean; `cargo test --lib` = **91 passed / 0 failed / 1 ignored** (unchanged).
- No TS test added — `terminal_run` requires a `tauri::AppHandle` not
  constructable in a unit test. The fix is a compile-time `cfg` split mirroring
  the proven `run_cli` pattern; verified by `cargo check --lib` (both branches
  compile).

## M129 — expandTemplate only replaced the first `$ARGUMENTS` occurrence (#440, failing functionality) (ninety-seventh analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1890 passed (215 files)**; `cargo test --lib` = 91 passed / 1 ignored.

**Failing functionality found**: `commands.ts` `expandTemplate` (#96, slash
command template expansion) used `String.replace('$ARGUMENTS', …)` which only
replaces the **first** occurrence. If a user-defined template contained
`$ARGUMENTS` twice (e.g. `Q: $ARGUMENTS\nA: $ARGUMENTS`), the second occurrence
would remain as the literal text `$ARGUMENTS` in the expanded prompt. The
`$1`/`$2`/… replacements already used `replaceAll`, so this was an inconsistency.

- [x] **#440** Changed `$ARGUMENTS` replacement from `replace` to `replaceAll`
  (with the same function replacement that prevents `$`-injection per #429).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1892 passed (215 files)** (+2);
  `cargo test --lib` = 91 passed / 1 ignored (unchanged).
- 2 new tests in `commands.test.ts`: multiple `$ARGUMENTS` with content; multiple
  `$ARGUMENTS` with empty args.

## M130 — Scenario visual_match overwrote pre-defined `after` with `undefined` + double-ran diff (#441, failing functionality) (ninety-eighth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1892 passed (215 files)**; `cargo test --lib` = 91 passed / 1 ignored.

**Failing functionality found**: `scenario.ts` `runScenario` (#78, browser
scenario runner) had two issues in the `visual_match` step path:

1. **Overwrote `step.args.after` with `undefined`**: The enriched step was
   `{ ...step.args, before: beforeScreenshot, after: undefined }`, which
   discarded any pre-defined reference screenshot the user had stored in
   `step.args.after`. The `executeStep` call then always failed with "before/
   after screenshots not available" — even when a reference existed.

2. **Double-ran the diff**: The runner always re-ran `diffScreenshots` at
   line 160–167 with captured `before/after` screenshots, regardless of
   whether `executeStep` had already done the comparison. When a pre-defined
   `after` was present, the `executeStep` result was silently overridden by
   the re-run (which compared two nearly-identical captured screenshots,
   always passing).

- [x] **#441** The enriched step no longer overwrites `after` (just injects
  `before`). `executeStep` now returns `diffRatio` for `visual_match`. The
  runner only re-runs the diff when `step.args.after` is NOT provided (no
  reference) — preserving the existing behavior for scenarios that rely on
  captured screenshots. When a reference IS provided, `executeStep` does the
  comparison and the runner uses its result (including `diffRatio`).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1894 passed (215 files)** (+2);
  `cargo test --lib` = 91 passed / 1 ignored (unchanged).
- 2 new tests in `scenario.test.ts`: pre-existing `step.args.after` is preserved
  (diff called once, `diffRatio` populated); no-reference + no-screenshot → fails
  with "not available".

## M131 — terminal_kill sent `session_id` (snake_case) to Tauri + McpStdioResponse camelCase hardening (#442, failing functionality) (ninety-ninth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1894 passed (215 files)**; `cargo test --lib` = 91 passed / 1 ignored.

**Failing functionality found**: `terminal.ts` `killTerminal` (#87, streaming
terminal) called `tauriInvoke('terminal_kill', { session_id: id })` using the
**snake_case** key `session_id`. Tauri v2 auto-camelCases top-level command
parameters, so the Rust `terminal_kill(session_id: u64)` expects the JS key
`sessionId` (camelCase). With `session_id`, Tauri would not find the `sessionId`
parameter and the command would **reject in production** — **the Stop/Kill
button in the terminal panel was broken**. (Same class of bug as #438/M127.
Existing tests mocked `_mocks.invoke` and read `args.session_id`, matching the
bug, so the casing error was invisible.)

Additionally, `McpStdioResponse` (#58) had `session_id` (snake_case) with no
`rename_all` — while no JS code currently reads the field, it was the last
Tauri response struct with a snake_case multi-word field, inconsistent with the
camelCase convention used everywhere else.

- [x] **#442** Changed `terminal_kill` invoke call to send `sessionId`
  (camelCase). Added `#[serde(rename_all = "camelCase")]` to
  `McpStdioResponse` and updated the `mcp-tauri.ts` stub to return `sessionId`.
  Updated the `terminal.test.ts` mock to read `args.sessionId`.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1895 passed (215 files)** (+1);
  `cargo test --lib` = **92 passed / 0 failed / 1 ignored** (+1).
- 1 new TS test (`terminal.test.ts`: verifies `sessionId` camelCase key, not
  `session_id`). 1 new cargo test (`mcp_stdio_response_serializes_camel_case`).

## M132 — Agent tool call dedup dropped all id-less calls after the first (#443, failing functionality) (one-hundredth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1895 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `agent.ts` `agenticChatStream` (#88, agentic
tool loop) deduplicated stream-chunk tool calls with
`!toolCalls.some(tc => tc.id === toolCall.id)`. The `ToolCall.id` field is
**optional** (`id?: string`). When a model sent multiple tool calls in a single
response without `id` (common with some Ollama models), `undefined === undefined`
is `true`, so **only the first tool call was kept — all subsequent tool calls in
that response were silently dropped**. The model's intent to call multiple tools
was lost, and only one tool would execute.

- [x] **#443** The dedup now uses a composite key: `toolCall.id` when present,
  otherwise `__no_id__:<function.name>:<function.arguments>`. This preserves
  the existing behavior for id-bearing calls (stream replay dedup) while
  ensuring that different tool calls without `id` (different name or args) are
  all kept. Two identical id-less calls (same name + same args) are still
  deduplicated.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1897 passed (215 files)** (+2);
  `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 2 new tests in `agentic.test.ts`: (1) two tool calls without `id` → both
  executed; (2) two identical tool calls with same `id` → only one execution.

## M133 — Ollama stream parser lost JSON lines split across chunks (#444, failing functionality) (one-hundred-first analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1897 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: Both `fetchOllamaChatStream` (`ollama.ts`)
and `agenticChatStream` (`agent.ts`) split the raw stream by `\n` and parsed
each line immediately — **without buffering incomplete trailing lines**. If a
TCP packet boundary fell in the middle of a JSON line (common with long tool-
call arguments or under network load), the first chunk would contain an
incomplete JSON object, `JSON.parse` would throw, and the data would be
silently lost (caught by the try/catch). The second chunk would contain the
rest of the line, which would also fail to parse. This could cause **missing
stream content, dropped tool calls, or corrupted assistant messages**. The MLX
stream parser (`fetchMlxChatStream`) already had the correct buffer pattern
(`lines.pop()` to keep the trailing partial line).

- [x] **#444** `fetchOllamaChatStream`, `agenticChatStream`,
  `pullOllamaModel`, and `createOllamaModel` now all use a buffer accumulator:
  each chunk is appended to the buffer, lines are split on `\n`, the last
  (possibly incomplete) line is kept in the buffer for the next chunk, and only
  complete lines are parsed. After the stream ends, any remaining buffered
  content is flushed as a final parse attempt. (The MLX parser and the
  connections SSE parser already had this pattern.)

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1900 passed (215 files)** (+3);
  `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 3 new tests in `ollama.test.ts`: (1) single JSON line split across two
  chunks → reassembled; (2) multiple JSON lines split across chunks → all
  parsed; (3) JSON line without trailing newline → flushed after stream ends.

## M134 — Agent catch block crashed on malformed tool call (missing `function`) (#445, failing functionality) (one-hundred-second analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1900 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `agent.ts` `agenticChatStream` catch block
(#88, agentic tool loop) accessed `toolCall.function.name` directly when a
tool execution threw. If the model sent a malformed tool call where `function`
was missing (some Ollama models send `{ name, arguments }` without a nested
`function` object), the catch block itself would throw a `TypeError: Cannot
read properties of undefined (reading 'name')`, crashing the entire agentic
loop instead of gracefully reporting the original error. The rest of the code
already used `toolCallName(toolCall)` which has a `toolCall.name` fallback.

- [x] **#445** Replaced both `toolCall.function.name` accesses in the catch
  block with `toolCallName(toolCall)`, which falls back to `toolCall.name`
  when `function` is absent. Added 6 unit tests for `toolCallName` /
  `toolCallArgs` covering: default `function.name`, top-level `name` fallback,
  missing `function` entirely, string/object/undefined argument parsing.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1906 passed (215 files)** (+6);
  `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 6 new tests in `tools.test.ts` for `toolCallName` / `toolCallArgs` helpers.

## M135 — MCP stdio `sendRequest` has no per-request timeout (#446, failing functionality) (one-hundred-third analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1906 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `McpStdioClient.sendRequest` (mcp.ts) puts a
`{resolve, reject}` pair into `pendingRequests` and relies entirely on the
background polling loop, process exit, or explicit `disconnect()` to settle the
Promise. If an MCP server accepts the JSON-RPC request but never responds (hung
process, deadlock, network stall on the server side), the Promise hangs
**forever** — the agentic tool loop that awaited `callTool()` is blocked
indefinitely with no timeout, no error, and no way for the user to recover
short of restarting the app. The HTTP client delegates to a Rust command with
its own HTTP-level timeout, so only the stdio path is affected.

- [x] **#446** Added a per-request timeout (default 30 s, configurable via
  `McpServerConfig.timeoutMs`) to `McpStdioClient.sendRequest`. When the timer
  fires, remove the pending entry and reject with a descriptive timeout error.
  The timer is cleared when the polling loop resolves/rejects the request
  normally. Also clear timers in `handleStdoutData`, `handleProcessExit`, and
  `disconnect()`.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1914 passed (215 files)** (+2);
  `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 2 new tests in `mcp-transport.test.ts`: (1) stdio server never responds →
  timeout error after 100ms; (2) normal response clears timeout correctly.

## M136 — `runAction` doesn't catch sandbox errors → unhandled rejection (#447, failing functionality) (one-hundred-third analysis pass)

**Failing functionality found**: `runAction` (customTools.ts) calls
`_sandboxRun(wrapCode, { message })` without a try/catch. If the user's action
code throws (syntax error, runtime error, timeout), the rejection propagates
unhandled to the `onClick` handler in `App.tsx` (line ~4894), which also has no
try/catch. The result: the user clicks an action button, nothing visible
happens, and an unhandled Promise rejection is logged in the console. The
filter functions (`applyFilterInlet`/`applyFilterOutlet`) already wrap their
sandbox calls in try/catch with non-fatal fallbacks — `runAction` is
inconsistent.

- [x] **#447** Wrapped the `_sandboxRun` call in `runAction` with a try/catch that
  logs the error and returns `null` (same contract as "action produced no
  injectable text"). Also wrapped the `onClick` handler in `App.tsx` with a
  try/catch that shows a status banner on failure.

### Result
- 3 new tests in `customTools.test.ts`: (1) sandbox throws runtime error →
  returns null; (2) sandbox throws syntax error → returns null; (3) sandbox
  throws timeout → returns null. No unhandled rejections.

## M137 — `scenario.ts` captures screenshots for every step, wasting IPC (#448, missing functionality) (one-hundred-third analysis pass)

**Missing functionality found**: `runScenario` (scenario.ts) calls
`captureScreenshot()` before AND after every step regardless of action type.
For `visual_match` steps the screenshots are needed for diff comparison, but
for `navigate`/`click`/`type`/`wait_for`/`assert` steps they are stored in
`StepResult` and never consumed — the UI (`App.tsx` line ~7820) only reads
`stepResults` for error messages, never for screenshots. Each
`captureScreenshot` is a Tauri IPC round-trip to the Rust CDP backend, so this
doubles the IPC traffic per step with zero benefit. Codex CLI and Claude Code
scenario/eval runners only capture screenshots when a visual assertion is
needed.

- [x] **#448** Added `captureScreenshots?: boolean` to `RunOptions` (default
  `false`). When false, only capture before/after screenshots for
  `visual_match` steps. When true, capture for all steps (debugging mode).
  This halves IPC calls for non-visual scenarios while preserving the debugging
  escape hatch.

### Result
- 4 new/updated tests in `scenario.test.ts`: (1) non-visual step skips
  screenshots by default (0 screenshot calls); (2) captureScreenshots: true
  captures before+after (2 calls); (3) visual_match step still captures by
  default; (4) mixed scenario: only visual_match steps capture screenshots.

## M138 — `executeToolCall` and safe accessors crash on malformed tool calls without `function` (#449, failing functionality) (one-hundred-fourth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1914 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: Three places still access
`toolCall.function.*` directly instead of using the safe accessors:
1. `tools.ts:79` `executeToolCall` calls `this.getTool(toolCall.function.name)`
   — crashes with `TypeError` if `function` is missing (some Ollama models
   send `{ name, arguments }` without nested `function`). The very next line
   already uses `toolCallName(toolCall)` which has the fallback — the `getTool`
   call should too.
2. `tools.ts:31` `toolCallName` falls through to `toolCall.function.name`
   when `toolCall.name` is undefined — crashes if `function` is also absent.
3. `App.tsx:4641` renders `toolCall.function.arguments` directly in the tool
   call display — crashes the entire message render if `function` is missing.

The root cause is that the `ToolCall` interface types `function` as required,
but reality (Ollama tool call outputs) proves it can be absent. M134 fixed the
agent catch block; these are the remaining instances of the same bug class.

- [x] **#449** Made `function` optional in `ToolCall` interface. Updated
  `toolCallName` to `toolCall.name ?? toolCall.function?.name ?? 'unknown'`.
  Updated `toolCallArgs` to handle missing `function` (return `{}`). Updated
  `executeToolCall` to use `toolCallName(toolCall)` for `getTool`. Updated
  `App.tsx` display to use safe accessors.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1924 passed (215 files)** (+7);
  `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 7 new tests in `tools.test.ts`: toolCallName with both name+function
  missing, toolCallArgs with top-level arguments (string/object/missing),
  executeToolCall with missing function, executeToolCall Tool not found.

## M139 — `browserPreview.ts` race: follow-up calls fire before `openPreview` IPC completes (#450, failing functionality) (one-hundred-fourth analysis pass)

**Failing functionality found**: `openPreview` sets `_open = true`
optimistically before the `preview_webview_open` IPC resolves. If
`navigatePreview`/`setBoundsPreview`/`reloadPreview` are called immediately
after (common from `BrowserPane`'s `useEffect`/`ResizeObserver`), they see
`_open === true` and send their IPC commands to a webview that hasn't been
created yet — the commands either silently fail or throw on the Rust side.
If `openPreview` later rejects, `_open` is reset to `false`, but the
follow-up commands already went out. Codex CLI's preview pane awaits the
open before issuing navigation/bounds commands.

- [x] **#450** Added an `_openingPromise` field to `browserPreview.ts`. While
  `openPreview` is in flight, `navigatePreview`/`setBoundsPreview`/
  `reloadPreview` await it before proceeding. If `openPreview` rejects, the
  follow-up calls no-op (since `_open` is false). Added a generation counter
  so stale `openPreview` calls from previous test sessions don't corrupt
  `_open` state. This eliminates the race without changing the fire-and-forget
  API for callers that don't care.

### Result
- 4 new tests in `browserPreview.test.ts`: navigate/setBounds/reload wait
  for openPreview to resolve; follow-up calls no-op when openPreview rejects
  while waiting. 2 BrowserPane tests updated to use async act() for promise
  chain flushing.

## M140 — `memory.ts` and `crossSessionMemory.ts` share localStorage key with incompatible data shapes (#451, failing functionality) (one-hundred-fifth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1924 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `memory.ts` (MEMORY_KEY = `'ollama_gui_memory'`)
stores a `MemoryEntry[]` array (`{ id, text, scope, createdAt }`). `crossSessionMemory.ts`
(STORAGE_KEY = `'ollama_gui_memory'`) stores a `Record<string, MemoryEntry>` object
(`{ key, value, updatedAt }`). Both are imported and used by `App.tsx`
(`memory.ts` for the sidebar memory panel, `crossSessionMemory.ts` for agent
`memory_set`/`memory_get` tools). When both modules write to the same key, they
corrupt each other's data:
- `memory.ts` writes an array → `crossSessionMemory.ts` reads it as a Record
  (array indices become keys, `Object.values` returns wrong shape).
- `crossSessionMemory.ts` writes an object → `memory.ts` reads it as an array,
  `[...loadMemory(), entry]` spreads object keys into the array, producing
  garbage that is then saved back.

- [x] **#451** Gave `crossSessionMemory.ts` a distinct storage key
  (`'ollama_gui_cross_session_memory'`) so the two stores no longer collide.

### Result
- 1 new test in `crossSessionMemory.test.ts`: verifies the two stores use
  different keys and don't corrupt each other's data.

## M141 — `mcpConfig.ts` `readPersisted` and `mcpAuth.ts` `authMetaStore` lack try/catch around JSON.parse (#452, failing functionality) (one-hundred-fifth analysis pass)

**Failing functionality found**: `mcpConfig.ts` `readPersisted()` calls
`JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')` with no try/catch. If
the stored data is corrupted (browser extension, partial write, version
mismatch), the `SyntaxError` propagates up through `mcpConfigStore.list()`,
which is called during app initialization — crashing the UI on startup.
Similarly, `mcpAuth.ts` `authMetaStore.save()` and `.load()` parse
`localStorage.getItem(AUTH_META_KEY)` without try/catch, crashing on
corrupted auth metadata. Every other localStorage-backed service in the
codebase (`presets.ts`, `openapiTools.ts`, `secrets.ts`, `memory.ts`, etc.)
already wraps these calls in try/catch with sensible defaults.

- [x] **#452** Wrapped `readPersisted()` in try/catch (return `[]` on error,
  plus `Array.isArray` guard). Wrapped `authMetaStore.save()` and `.load()`
  in try/catch (return `{}` / `null` on error).

### Result
- 2 new tests in `mcpConfig.test.ts`: corrupted JSON and non-array type.
- 4 new tests in `mcpAuth.test.ts`: corrupted load, corrupted save, unknown
  server, normal round-trip.

## M142 — `ollama.ts` `fetchOllamaModels` has unused `includeCloudModels` parameter (#453, dead code) (one-hundred-fifth analysis pass)

**Dead code found**: `fetchOllamaModels(endpoint, includeCloudModels = false)`
accepts a second parameter `includeCloudModels` that is never referenced in the
function body — it always returns only `localModels`. The sole caller
(`App.tsx:936`) passes only the endpoint. This is dead code that could mislead
contributors into thinking cloud models are merged here.

- [x] **#453** Removed the unused `includeCloudModels` parameter from
  `fetchOllamaModels` and its type signature. No test stubs referenced it.

### Result
- Dead code removed; tsc clean. No new tests needed (parameter was unused).

## M143 — `storage.ts` `getSessions`/`getFolders`/`getProjects` lack try/catch around JSON.parse (#454, failing functionality) (one-hundred-sixth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1931 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `storage.ts` — the main session/folder/project
persistence layer — calls `JSON.parse(localStorage.getItem(...))` without
try/catch in `getSessions()`, `getFolders()`, and `getProjects()`. If the
stored data is corrupted (browser extension, partial write, version mismatch),
the `SyntaxError` propagates up and crashes the app. `getSessions()` is called
in 10+ places across `App.tsx` including the `useState` initializer for
projects (line 542), which runs on mount — so corrupted sessions data crashes
the app on startup. Additionally, `updateSession()`, `deleteSession()`,
`deleteFolder()`, and `deleteProject()` call `localStorage.setItem()` without
`QuotaExceededError` handling (unlike `saveSession` which already handles it),
so a full localStorage throws an unhandled exception. Every other
localStorage-backed service (`presets.ts`, `openapiTools.ts`, `secrets.ts`,
`memory.ts`, etc.) already wraps these calls in try/catch.

- [x] **#454** Wrapped `getSessions()`, `getFolders()`, `getProjects()` in
  try/catch (return `[]` on error, plus `Array.isArray` guard). Wrapped
  `updateSession()`, `deleteSession()`, `deleteFolder()`, `deleteProject()`
  `setItem` calls in try/catch for `QuotaExceededError`.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1938 passed (215 files)**
  (+7); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 7 new tests in `storage.test.ts`: corrupted sessions/folders/projects JSON,
  non-array types, QuotaExceededError on updateSession and deleteSession.

## M144 — `createOllamaModel` re-throws SyntaxError on malformed JSON lines (#455, failing functionality) (one-hundred-seventh analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1938 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `createOllamaModel` (ollama.ts) has an
inconsistent catch block that re-throws `SyntaxError` from `JSON.parse` on
malformed stream lines, unlike `pullOllamaModel` which silently logs and skips.
The catch block:
```ts
catch (e) {
  if (e instanceof Error && e.message !== line) throw e;
}
```
was intended to re-throw `chunk.error` errors while swallowing `JSON.parse`
failures, but `SyntaxError` (which extends `Error`) has `e.message !== line`
(true — the error message is not the raw JSON line), so it is also re-thrown.
This crashes the model-creation stream on any malformed JSON line, while
`pullOllamaModel` handles the same situation gracefully. The flush block at
the end of the function has the same bug.

- [x] **#455** Replace the catch blocks in `createOllamaModel` with
  `SyntaxError`-aware handling: silently skip malformed JSON lines (matching
  `pullOllamaModel`'s behavior), re-throw `chunk.error` errors. Add a test
  that verifies a malformed line in the stream does not crash the function.

- [x] **#455** Replaced the catch blocks in `createOllamaModel` with
  `SyntaxError`-aware handling: `if (e instanceof SyntaxError) continue;`
  (loop) / `return;` (flush), re-throwing `chunk.error` errors. Matches
  `pullOllamaModel`'s graceful skip behavior.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1941 passed (215 files)**
  (+3); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 3 new tests in `ollama.test.ts` (#455): skips malformed JSON lines,
  re-throws chunk.error, skips malformed JSON in flush buffer.

## M145 — Ollama API functions discard response body error on non-ok responses (#456, failing functionality) (one-hundred-eighth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1941 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: All five Ollama API functions
(`fetchOllamaChatStream`, `fetchOllamaModels`, `createOllamaModel`,
`pullOllamaModel`, `deleteOllamaModel`) throw `new Error(\`Ollama … error:
${response.statusText}\`)` on non-ok HTTP responses, discarding the JSON body
that Ollama returns with the detailed failure reason (e.g. `{"error":"model
'llama3' not found, try pulling it first"}`). The user sees a generic
"Ollama API error: Not Found" or "Internal Server Error" instead of the
actionable message. Worse, `formatError` in `errorMessages.ts` checks for
`"model" … "not found"` to map to the friendly "Model not available" guidance,
but the actual error text is lost so the mapping never fires — the user gets
the unhelpful fallback "Something went wrong — Ollama API error: Not Found".
This contrasts with agentic GUIs (Codex, Claude) which always surface the
server-provided error detail.

- [x] **#456** Added `ollamaErrorFromResponse(response, prefix)` helper that
  reads `response.json()` and extracts the `.error` field, falling back to
  `statusText` when the body is absent, non-JSON, or has no `.error`. Wired it
  into all five Ollama API non-ok handlers.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1950 passed (215 files)**
  (+9); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 9 new tests in `ollama.test.ts` (#456): helper extracts body error, falls
  back to statusText when no `.error` / `json()` throws / empty `.error`, and
  each of the 5 API functions surfaces the body error on non-ok responses.

## M146 — Agentic chat stream discards response body error on non-ok (#457, failing functionality) (one-hundred-ninth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1950 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `agenticChatStream` in `agent.ts` makes its
own `fetch` call to the Ollama chat endpoint (separate from
`fetchOllamaChatStream` in `ollama.ts`) and handles non-ok responses with
`throw new Error(\`Ollama API error: ${response.statusText}\`)` — the exact same
bug fixed in M145 (#456) for the non-agentic path. When the agent loop hits a
non-ok response (e.g. model not found), it discards the JSON body error that
Ollama returns (`{"error":"model 'llama3' not found, try pulling it first"}`),
so `formatError` cannot map to the helpful "Model not available" guidance and
the user sees "Ollama API error: Not Found". This is the primary code path for
agentic/tool-using conversations, so the bug affects every agentic run that
encounters an API error.

- [x] **#457** Imported `ollamaErrorFromResponse` from `./ollama` and replaced
  the inline non-ok handler in `agenticChatStream` with
  `throw await ollamaErrorFromResponse(response, 'Ollama API error')`.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1952 passed (215 files)**
  (+2); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 2 new tests in `agent.test.ts` (#457): surfaces body `.error` on non-ok via
  `onError`, falls back to statusText when body has no `.error`.

## M147 — `streamOpenAiChat` discards response body error on non-ok (#458, failing functionality) (one-hundred-tenth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1952 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `streamOpenAiChat` in `connections.ts`
handles non-ok HTTP responses with
`throw new Error(\`OpenAI stream error: ${res.statusText}\`)`, discarding the
JSON body that OpenAI-compatible endpoints (OpenAI, LM Studio, vLLM, etc.)
return with the detailed failure reason:
`{"error": {"message": "Invalid API key provided", ...}}`. The user sees a
generic "OpenAI stream error: Unauthorized" instead of the actionable
"Invalid API key provided". This affects every chat sent through a registered
OpenAI-compatible connection that encounters an API error — a core feature for
users who connect external endpoints alongside Ollama. This is the same class
of bug as M145 (#456) and M146 (#457), but the OpenAI error format is nested
(`error.message`) rather than a flat string.

- [x] **#458** Added `openAiErrorFromResponse(res, prefix)` helper that reads
  `res.json()` and extracts the error detail from three common formats:
  `body.error.message` (OpenAI), `body.error` as string (Ollama/proxy), and
  `body.message` / `body.detail` (some proxies). Falls back to `statusText`
  when the body is absent, non-JSON, or has no error field. Wired it into the
  `streamOpenAiChat` non-ok handler.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1958 passed (215 files)**
  (+5); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 6 new tests in `connections.test.ts` (#458): helper extracts nested
  `error.message`, string `error`, top-level `message`/`detail`, falls back to
  statusText on no-error-body / `json()` throws, and `streamOpenAiChat`
  surfaces body error on non-ok.

## M148 — `makeSummarizeFn` and `embed` discard response body error on non-ok (#459, failing functionality) (one-hundred-eleventh analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1958 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: The last two Ollama API callers that still
discard the response body error on non-ok responses:
- `makeSummarizeFn` in `compaction.ts` — called for conversation compaction
  (auto-compact), throws `Summarize failed: ${resp.statusText}` when the
  summarization request fails (e.g. model not found).
- `embed` in `rag.ts` — called for RAG indexing and retrieval, throws
  `Ollama embed error: ${response.statusText}` when the embedding request
  fails (e.g. embedding model not pulled).

Both call Ollama endpoints (`/api/chat` and `/api/embed` respectively) that
return `{"error": "..."}` in the body, but the functions only surface the
generic HTTP statusText. When compaction or RAG fails, the user sees
"Summarize failed: Internal Server Error" or "Ollama embed error: Not Found"
instead of the actionable "model not found, try pulling it first". These are
the last remaining Ollama API callers that don't use `ollamaErrorFromResponse`
(fixed in M145 #456 for the chat/agent paths, M146 #457 for the agentic loop).

- [x] **#459** Imported `ollamaErrorFromResponse` in both `compaction.ts` and
  `rag.ts`. Replaced the inline non-ok handlers with
  `throw await ollamaErrorFromResponse(resp, 'Summarize failed')` and
  `throw await ollamaErrorFromResponse(response, 'Ollama embed error')`.
  Exported `embed` from `rag.ts` (was private) for direct unit testing.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1964 passed (215 files)**
  (+5); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 3 new tests in `compaction.test.ts` (#459): surfaces body `.error` on
  non-ok, falls back to statusText, returns content on success.
- 3 new tests in `rag.test.ts` (#459): surfaces body `.error` on non-ok,
  falls back to statusText, returns embeddings on success.

## M149 — OAuth non-ok responses discard body error detail (#460, failing functionality) (one-hundred-twelfth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1964 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: Three OAuth 2.0 non-ok handlers in
`mcpAuth.ts` throw generic `statusText` errors, discarding the JSON body that
OAuth endpoints return per RFC 6749 §5.2 and RFC 7591 §3.2:
- `getOrRegisterClient` (dynamic client registration): `Dynamic client
  registration failed: ${res.statusText}`
- `exchangeCode` (authorization-code → token): `Token exchange failed:
  ${res.statusText}`
- `refreshAccessToken` (refresh-token → new token): `Token refresh failed:
  ${res.statusText}`

OAuth endpoints return `{"error": "invalid_grant", "error_description":
"The refresh token is invalid or expired."}` in the body. The user sees
"Token refresh failed: Bad Request" instead of the actionable "The refresh
token is invalid or expired." This is especially harmful for MCP OAuth — when
a server's token expires and the refresh fails, the user has no idea why and
no guidance on how to fix it (re-authenticate, check scopes, etc.). Agentic
GUIs like Claude's MCP connector surface the OAuth error detail directly.

- [x] **#460** Added `oauthErrorFromResponse(res, prefix)` helper that reads
  `res.json()` and extracts `error_description` (RFC 6749), falling back to
  `error`, then `message`, then `statusText`. Wired it into all three OAuth
  non-ok handlers. Exported `exchangeCode` and `refreshAccessToken` (were
  private) for direct unit testing.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1971 passed (215 files)**
  (+7); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 7 new tests in `mcpAuth.test.ts` (#460): helper extracts `error_description`,
  falls back to `error`, falls back to `statusText` (no error body / `json()`
  throws), and each of the 3 OAuth functions surfaces body error on non-ok.

## M150 — `McpHttpClient.connect()` discards response body error on non-ok (#461, failing functionality) (one-hundred-thirteenth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1971 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `McpHttpClient.connect()` in `mcp.ts`
handles non-ok HTTP responses with
`throw new Error(\`HTTP MCP connection failed: ${response.statusText}\`)`,
discarding the JSON body that MCP HTTP servers return with the failure reason.
MCP servers speak JSON-RPC, so errors arrive as
`{"error": {"code": -32000, "message": "Invalid API key"}}` even on non-ok
HTTP status codes (401, 403, 404, 500). The user sees "Failed to connect to
HTTP MCP server: Error: HTTP MCP connection failed: Unauthorized" instead of
the actionable "Invalid API key". This is the connection entry point for every
HTTP-based MCP server — a core agentic feature — so the bug affects every HTTP
MCP connection attempt that encounters an error. The code already reads
`result.error.message` when `response.ok` is true, but skips the body entirely
when `response.ok` is false.

- [x] **#461** Added `mcpHttpErrorDetail(response)` helper that reads
  `response.json()` and extracts the error detail from `body.error.message`
  (JSON-RPC), `body.error` as string, or `body.message`, falling back to
  `statusText` when the body is absent, non-JSON, or has no error field. Wired
  it into the `connect()` non-ok handler.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1975 passed (215 files)**
  (+4); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 4 new tests in `mcp-transport.test.ts` (#461): surfaces JSON-RPC
  `error.message` on non-ok, surfaces string `error`, falls back to
  `statusText` on no-error-body / `json()` throws.

## M151 — `fetchMlxChatStream` and `fetchMlxEmbeddings` discard body error on non-ok (#462, failing functionality) (one-hundred-fourteenth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1975 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: The two MLX server API functions in
`mlx.ts` handle non-ok HTTP responses with generic statusText/status errors,
discarding the JSON body that the MLX OpenAI-compatible server returns with
the detailed failure reason:
- `fetchMlxChatStream`: `MLX server error: ${response.status} ${response.statusText}`
- `fetchMlxEmbeddings`: `MLX embeddings error: ${response.status}`

The MLX server (`mlx_lm.server`) is OpenAI-compatible and returns
`{"error": {"message": "model not loaded"}}` in the body on errors. The user
sees "MLX server error: 500 Internal Server Error" instead of the actionable
"model not loaded". This affects Apple Silicon users who enable MLX
acceleration — a key performance feature — when the MLX server encounters any
error (model not loaded, port conflict, OOM, etc.).

- [x] **#462** Imported `openAiErrorFromResponse` from `./connections` (the MLX
  server is OpenAI-compatible, so the same error format applies). Replaced
  both non-ok handlers with
  `throw await openAiErrorFromResponse(response, \`MLX server error ${response.status}\`)`
  and
  `throw await openAiErrorFromResponse(response, \`MLX embeddings error ${response.status}\`)`.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1980 passed (215 files)**
  (+5); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 5 new tests in `mlx.test.ts` (#462): `fetchMlxChatStream` surfaces body
  `error.message` / falls back to statusText; `fetchMlxEmbeddings` surfaces
  body error / falls back to statusText / returns embeddings on success.

## M152 — `imagegen.ts` unprotected JSON.parse crashes on non-JSON response bodies (#463, failing functionality) (one-hundred-fifteenth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1980 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: Four `JSON.parse(resp.body)` calls in
`imagegen.ts` are unprotected — if the image generation API returns a 200
HTTP status but with a non-JSON body (HTML error page from a reverse proxy,
empty body, text error from a misconfigured server), the function crashes
with an unhelpful `SyntaxError: Unexpected token...` instead of a meaningful
error message:
- `generateA1111` line 126: `JSON.parse(resp.body)` on the A1111 response
- `generateComfyUI` line 153: `JSON.parse(queueResp.body)` on the ComfyUI
  queue response
- `generateComfyUI` line 161: `JSON.parse(histResp.body)` on the history poll
- `generateOpenAI` line 195: `JSON.parse(resp.body)` on the DALL-E response

Additionally, the ComfyUI queue error (`ComfyUI queue error ${status}`) did
not include the response body, so the user had no detail about why the queue
request failed (e.g. "invalid workflow: missing CLIPTextEncode").

- [x] **#463** Wrapped all four `JSON.parse` calls in try/catch. The A1111,
  DALL-E, and ComfyUI queue parses throw meaningful errors including a body
  snippet (`<backend> returned non-JSON response: <snippet>`). The ComfyUI
  history poll parse silently `continue`s on non-JSON (the poll loop retries).
  Updated the ComfyUI queue error to include the body snippet.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1984 passed (215 files)**
  (+4); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 4 new tests in `imagegen.test.ts` (#463): A1111 non-JSON 200 response,
  DALL-E non-JSON 200 response, ComfyUI non-JSON queue response, ComfyUI
  queue error includes body snippet.

## M153 — `toolCallArgs` throws unhandled SyntaxError on malformed JSON tool arguments (#464, failing functionality) (one-hundred-sixteenth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1984 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `toolCallArgs` in `tools.ts` calls
`JSON.parse(args)` without try/catch when a tool call's arguments are a
string. Smaller Ollama models frequently produce malformed JSON arguments
(single quotes `{'a': 1}`, trailing commas, truncated JSON, or plain text),
which causes `JSON.parse` to throw a `SyntaxError`. This propagates into the
agent loop where it's caught by the tool-execution catch block and sent back
to the model as `"Error: Unexpected token ' in JSON at position 0"` — an
unhelpful message that doesn't tell the model what went wrong with its
arguments or how to fix them. The model cannot recover because it doesn't
understand the JSON parse error in the context of its tool call.

Agentic tools (Codex, Claude) handle this gracefully by treating unparseable
arguments as empty, letting the tool's own parameter validation surface a
clear "missing required parameter: x" error that the model can understand and
retry with correct arguments.

`toolCallArgs` is called in two critical paths: `agent.ts:257` (autonomy/
approval gate) and `tools.ts:88` (`executeToolCall`), so the bug affects every
tool call with string arguments in the agentic loop.

- [x] **#464** Wrapped `JSON.parse(args)` in try/catch in `toolCallArgs`,
  returning `{}` on parse failure. This lets the tool's own parameter
  validation produce a clear, actionable error that the model can understand
  and retry, instead of a raw `SyntaxError`.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1989 passed (215 files)**
  (+5); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 5 new tests in `tools.test.ts` (#464): malformed JSON (single quotes),
  truncated JSON, non-JSON string, malformed top-level arguments, and
  `executeToolCall` does not crash on malformed JSON arguments.

## M154 — `mcpAuth.ts` `loadClients`/`tokenStore.load` unprotected JSON.parse on corrupted keychain data (#465, failing functionality) (one-hundred-seventeenth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1989 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: Two `JSON.parse` calls in `mcpAuth.ts` read
from the OS keychain via `secretStore` without try/catch:
- `loadClients()` line 122: `return raw ? JSON.parse(raw) : {};` — reads
  client credentials. Called in `getOrRegisterClient()` during every MCP
  OAuth registration attempt.
- `tokenStore.load()` line 248: `return raw ? (JSON.parse(raw) as OAuthTokens) : null;`
  — reads OAuth tokens. Called in `getValidTokens()` before every MCP HTTP
  request that requires auth.

If the keychain data is corrupted (OS keychain migration, encoding issues,
partial writes, version mismatch), these throw an unhandled `SyntaxError`
that crashes the MCP auth flow. The user sees "Unexpected token..." instead
of being prompted to re-authenticate. Every other localStorage-backed service
in the codebase already wraps these calls in try/catch with safe defaults
(fixed in M141 #452 for `mcpConfig`/`mcpAuth` localStorage, M143 #454 for
`storage.ts`), but the keychain-backed reads were missed.

- [x] **#465** Wrapped both `JSON.parse` calls in try/catch. `loadClients`
  returns `{}` on parse failure (triggers re-registration on next auth).
  `tokenStore.load` returns `null` on parse failure (triggers re-auth).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1993 passed (215 files)**
  (+4); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 4 new tests in `mcpAuth.test.ts` (#465): `tokenStore.load` returns null on
  corrupted data, returns valid tokens on well-formed data, returns null when
  no data stored, and `getOrRegisterClient` re-registers when client data is
  corrupted.

## M155 — `streamOpenAiChat` and `fetchMlxChatStream` drop final SSE event without trailing newline (#466, failing functionality) (one-hundred-eighteenth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1993 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: Both SSE-stream parsers — `streamOpenAiChat`
in `connections.ts` and `fetchMlxChatStream` in `mlx.ts` — lack a flush block
after the reader `while` loop. When the server sends the last SSE event
without a trailing newline (common — many SSE implementations don't add `\n`
after the final event, and TCP/stream closures can split mid-line), that
content remains in the line buffer (`buf`/`buffer`) and is silently dropped
when the stream closes. The user sees an incomplete response — the last
content delta (or the `[DONE]` sentinel) is lost.

Both `fetchOllamaChatStream` in `ollama.ts` and `agenticChatStream` in
`agent.ts` already have flush blocks (`if (streamBuf.trim()) { try { ... }
catch { /* ignore trailing partial */ } }`), but the OpenAI-compatible and
MLX SSE parsers were missed. This affects every chat sent through a
registered OpenAI-compatible connection (LM Studio, vLLM, etc.) or the MLX
server when the last event lacks a trailing newline.

- [x] **#466** Added flush blocks to both `streamOpenAiChat` and
  `fetchMlxChatStream`. After the reader loop, if the buffer contains a
  complete `data:` line, it's parsed and the content delta is delivered via
  `onChunk`. A trailing `[DONE]` in the flush buffer triggers `return`.
  Malformed trailing data is silently skipped (matching the in-loop behavior).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **1997 passed (215 files)**
  (+4); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 2 new tests in `connections.test.ts` (#466): flushes last SSE event
  without trailing newline, flushes trailing `[DONE]` without newline.
- 2 new tests in `mlx.test.ts` (#466): same two scenarios for the MLX stream.

## M156 — `fetchOpenApiSpec` discards body error and crashes on non-JSON responses (#467, failing functionality) (one-hundred-nineteenth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **1997 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `fetchOpenApiSpec` in `openapiTools.ts` has
two issues on its fetch fallback path (used when Tauri is unavailable):
- Non-ok handler: `throw new Error(\`HTTP ${res.status}\`)` — discards the
  response body. OpenAPI spec servers return error details in the body (e.g.
  `{"error": "Invalid API key"}` or `Unauthorized: invalid API key`). The
  user sees "HTTP 401" instead of the actionable detail.
- Success path: `return res.json() as Promise<OASpec>` — unprotected. If the
  server returns a 200 status with a non-JSON body (HTML error page from a
  reverse proxy, empty body), `res.json()` throws an unhelpful `SyntaxError`.

Additionally, the Tauri path's non-success handler (`HTTP ${res.status}`) and
`JSON.parse(res.body)` didn't include the body or handle non-JSON gracefully
(though the `JSON.parse` was inside a try that fell through to fetch, the
non-success throw also fell through, which is intentional — but the error
detail was still lost if both paths failed).

- [x] **#467** Updated both paths: Tauri non-success now includes the body
  snippet (`HTTP ${res.status}: ${res.body.slice(0, 200)}`); Tauri
  `JSON.parse` throws a meaningful non-JSON error instead of falling through
  silently; fetch non-ok reads `res.text()` and includes it in the error;
  fetch `res.json()` is wrapped in try/catch with a meaningful non-JSON error.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2000 passed (215 files)**
  (+3); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 3 new tests in `openapiTools.test.ts` (#467): throws with body snippet on
  non-ok, throws meaningful error on non-JSON 200, returns parsed spec on
  success.

## M157 — `transcribeBlob` discards body error on non-ok and crashes on non-JSON (#468, failing functionality) (one-hundred-twentieth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2000 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `transcribeBlob` in `stt.ts` had two issues:
- Non-ok handler: `throw new Error(\`Whisper inference error ${res.status}: ${res.statusText}\`)`
  — discarded the response body. The whisper.cpp server returns error details
  as `{"error": "audio codec not supported"}` in the body. The user saw
  "Whisper inference error 415: Unsupported Media Type" instead of the
  actionable "audio codec not supported".
- Success path: `const data = await res.json()` — unprotected. If the server
  returned a 200 status with a non-JSON body (proxy error page, empty body),
  `res.json()` threw an unhelpful `SyntaxError`.

The function already checked `data.error` after reading the body on success,
but skipped the body entirely on non-ok — the exact pattern fixed across
M145–M156 for other API callers.

- [x] **#468** Updated the non-ok handler to read `res.json()` and extract the
  `error` field, falling back to `statusText` when the body is absent,
  non-JSON, or has no error. Wrapped the success-path `res.json()` in
  try/catch with a meaningful "non-JSON response" error.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2003 passed (215 files)**
  (+3); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 3 new tests in `stt.test.ts` (#468): surfaces body error on non-ok, falls
  back to statusText when no body error, throws meaningful error on non-JSON
  200 response.

## M158 — `streamOpenAiChat` SSE parser skips `data:` events without space after colon (#469, failing functionality) (one-hundred-twenty-first analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2003 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `streamOpenAiChat` in `connections.ts`
required `line.startsWith('data: ')` (with a space after the colon) to
recognize SSE data events. The HTML5 SSE spec allows both `data: value` and
`data:value` — the field value is everything after the first colon, with a
single leading space stripped. Some OpenAI-compatible servers and proxies
emit `data:{"choices":...}` without a space. Those events were silently
skipped, losing content deltas and potentially the `[DONE]` sentinel — the
user would see an incomplete or empty response with no error.

The MLX SSE parser (`fetchMlxChatStream` in `mlx.ts`) already handled both
forms correctly (`startsWith('data:')` + `slice(5).trim()`), but the
OpenAI-compatible parser in `connections.ts` was stricter. This
inconsistency meant the same server might work through the MLX path but fail
through the connections path.

- [x] **#469** Changed both the in-loop check and the flush block from
  `startsWith('data: ')` / `slice(6)` to `startsWith('data:')` / `slice(5)`,
  matching the SSE spec and the MLX parser. The `trim()` after the slice
  handles the optional leading space.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2005 passed (215 files)**
  (+2); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 2 new tests in `connections.test.ts` (#469): parses `data:{...}` without
  space in the stream, parses `data:{...}` without space in the flush buffer.

## M159 — `mcpConfig.ts` unprotected `setItem` crashes on QuotaExceededError (#470, failing functionality) (one-hundred-twenty-second analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2005 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: Three `localStorage.setItem` calls in
`mcpConfig.ts` are unprotected against `QuotaExceededError`:
- `saveServer` line 97: `localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))`
- `delete` line 120: `localStorage.setItem(STORAGE_KEY, ...)`
- `markConnected` line 129: `localStorage.setItem(STORAGE_KEY, ...)`

When localStorage is full (common on long-running sessions with many
conversations, or browsers with low quota), these throw an unhandled
`DOMException` that crashes the MCP server configuration operation. The user
loses their server config changes with no error message. The `readPersisted`
function was already wrapped in try/catch (M141 #452), and `storage.ts`
mutations were wrapped (M143 #454), but the `mcpConfig.ts` mutation methods
were missed.

- [x] **#470** Added `safePersist()` helper that wraps `setItem` in try/catch
  (silently ignores `QuotaExceededError` — the config stays in memory for the
  current session). Replaced all three unprotected `setItem` calls with
  `safePersist()`.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2008 passed (215 files)**
  (+3); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 3 new tests in `mcpConfig.test.ts` (#470): `save()`, `delete()`, and
  `markConnected()` do not throw on `QuotaExceededError`.

## M160 — Remaining unprotected `localStorage.setItem` calls crash on QuotaExceededError (#471, failing functionality) (one-hundred-twenty-third analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2008 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: 20 `localStorage.setItem` calls across 16
service files were unprotected against `QuotaExceededError`. When localStorage
is full (common on long-running sessions with many conversations, or browsers
with low quota), these throw an unhandled `DOMException` that crashes the
operation with no error message.

Files and functions affected:
- `workspace.ts` — `saveWorkspaceState` (workspace open/close)
- `connections.ts` — `saveConnections` (model connection config)
- `commands.ts` — `saveUserCommands` (slash command config)
- `presets.ts` — `savePresets`, `setActivePreset` (model presets)
- `memory.ts` — `saveMemory` (cross-session memory)
- `agentAutonomy.ts` — `saveSettings` (autonomy level)
- `tokenEstimate.ts` — `savePricing` (token pricing)
- `voice.ts` — `saveVoiceSettings` (voice settings)
- `scenario.ts` — `saveScenario`, `deleteScenario` (scenarios)
- `customTools.ts` — `saveCustomTools`, `saveFunctionDefs` (custom tools)
- `imagegen.ts` — `saveImageGenConfig` (image generation config)
- `secrets.ts` — `saveRefs` (secret references)
- `stt.ts` — `saveSttConfig` (STT config)
- `websearch.ts` — `saveWebSearchConfig` (web search config)
- `openapiTools.ts` — `saveOpenApiServers` (OpenAPI server config)
- `promptLibrary.ts` — `savePrompts` (prompt library)
- `mcpAuth.ts` — `authMetaStore.save` (OAuth metadata)

Previous milestones fixed `storage.ts` (M143 #454) and `mcpConfig.ts`
(M159 #470). This milestone completes the codebase-wide sweep — every
`localStorage.setItem` call in `src-frontend/services/` is now protected.

- [x] **#471** Wrapped all 20 unprotected `setItem` calls in try/catch across
  16 service files. The pattern is `try { localStorage.setItem(...) } catch { /* quota */ }`
  — the operation continues with in-memory state for the current session.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2011 passed (215 files)**
  (+3); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 3 new tests: `presets.test.ts` (savePresets + setActivePreset don't throw on
  quota), `workspace.test.ts` (openWorkspace doesn't throw on quota).

## M161 — `agenticChatStream` omits assistant message with tool_calls from conversation context (#472, failing functionality) (one-hundred-twenty-fourth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2011 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `agenticChatStream` in `agent.ts` executes
tool calls and pushes tool results to `currentMessages`, but does NOT push
the assistant's intermediate message (the one containing the content and
`tool_calls`) to `currentMessages` before the tool results. In the next
iteration, the model sees:

```
[previous messages...]
{ role: 'tool', content: 'tool result', name: 'tool_name' }
```

Without the preceding assistant message that initiated the tool calls:

```
[previous messages...]
{ role: 'assistant', content: 'Let me check that.', tool_calls: [...] }
{ role: 'tool', content: 'tool result', name: 'tool_name' }
```

The Ollama chat API expects the conversation to follow the
assistant→tool→assistant pattern. Without the assistant message in context,
the model sees tool results appearing without a preceding assistant message,
causing confusion, lower-quality responses, and in some cases failure to
understand the conversation flow. This is a well-known pattern in agentic
tool-use loops — Codex, Claude, and other agentic GUIs all include the
assistant's tool-call message in the context.

- [x] **#472** Added a `currentMessages.push({ role: 'assistant', content:
  assistantMessage, tool_calls, ... })` call before the tool execution loop,
  so the model sees its own tool-call message followed by the tool results
  in the next iteration.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2012 passed (215 files)**
  (+1); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 1 new test in `agent.test.ts` (#472): verifies the second fetch request's
  body contains the assistant message with content + tool_calls, and that
  the tool result message comes after it.

## M162 — `App.tsx` unprotected `localStorage.setItem` calls crash on QuotaExceededError (#473, failing functionality) (one-hundred-twenty-fifth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2012 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: 19 `localStorage.setItem` calls in
`App.tsx` (the 8381-line main UI component) were unprotected against
`QuotaExceededError`. These are in UI event handlers — settings toggles
(auto-compact, resume-last-session, send-on-Ctrl+Enter), font scale, code
word-wrap, system prompt, generation options, structured output, base URL,
starred models, sort mode, compaction threshold, and slash commands. When
localStorage is full, toggling a setting or typing a system prompt crashes
the UI interaction with an unhandled `DOMException`. Three calls already had
try/catch (recent models, notify-complete, sound-complete), but the other 16
were unprotected.

Previous milestones (M143 #454, M159 #470, M160 #471) protected all
`setItem` calls in `src-frontend/services/`. This milestone completes the
sweep for the UI layer.

- [x] **#473** Added `safeSetItem(key, value)` utility to `platform.ts` that
  wraps `localStorage.setItem` in try/catch. Replaced all 19
  `localStorage.setItem` calls in `App.tsx` with `safeSetItem` (the 3 that
  already had try/catch are now `try { safeSetItem(...) } catch` — redundant
  but harmless).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2015 passed (215 files)**
  (+3); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 3 new tests in `platform.test.ts` (#473): stores value normally, doesn't
  throw on `QuotaExceededError`, doesn't throw on other `DOMException`.

## M163 — `checkpoints.ts` `saveAll` unprotected `sessionStorage.setItem` crashes on QuotaExceededError (#474, failing functionality) (one-hundred-twenty-sixth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2015 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `checkpoints.ts:35` `saveAll()` calls
`sessionStorage.setItem` without a try/catch. When sessionStorage is full,
creating or deleting a checkpoint throws an unhandled `QuotaExceededError`,
crashing the agent's file-state checkpoint system. `loadAll()` already has a
try/catch but `saveAll()` did not — the same pattern fixed across
`localStorage.setItem` in M159–M162.

- [x] **#474** Added `safeSessionSetItem(key, value)` utility to `platform.ts`
  (wraps `sessionStorage.setItem` in try/catch). Replaced the bare
  `sessionStorage.setItem` in `saveAll()` with `safeSessionSetItem`.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2018 passed (215 files)**
  (+3); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 3 new tests in `platform.test.ts` (#474): stores value normally, doesn't
  throw on `QuotaExceededError`, doesn't throw on other `DOMException`.

## M164 — `crossSessionMemory.ts` `saveEntries` unprotected `setItem` crashes on QuotaExceededError (#475, failing functionality) (one-hundred-twenty-seventh analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2018 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing functionality found**: `crossSessionMemory.ts:54` `saveEntries()`
calls `store().setItem()` without a try/catch. When localStorage is full,
calling `memorySet` or `memoryDelete` throws an unhandled
`QuotaExceededError`, crashing the cross-session memory feature. `loadEntries()`
already had a try/catch but `saveEntries()` did not.

- [x] **#475** Wrapped `store().setItem` in `saveEntries()` with try/catch.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2020 passed (215 files)**
  (+2); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 2 new tests in `crossSessionMemory.test.ts` (#475): `memorySet` and
  `memoryDelete` don't throw on `QuotaExceededError`.

## M165 — Missing Ollama model memory management API: load, unload, running models, version (#476, missing functionality) (one-hundred-twenty-eighth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2020 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Missing functionality found**: The Ollama API exposes four endpoints that
the GUI did not use, all of which Codex GUI and other agentic tools surface:
- `GET /api/ps` — list models currently loaded in memory (RAM/VRAM)
- `POST /api/generate` with empty prompt + `keep_alive` — pre-load a model
  so the first chat request doesn't pay cold-start latency
- `POST /api/generate` with `keep_alive: 0` — unload a model to free RAM
- `GET /api/version` — server version (for feature-gating and display)

Without these, the user has no visibility into which models are consuming
memory, cannot pre-load a model before a long agentic run, and cannot free
RAM when running multiple large models.

- [x] **#476** Added `fetchRunningModels()`, `loadOllamaModel()`,
  `unloadOllamaModel()`, and `fetchOllamaVersion()` to `ollama.ts`. All use
  `ollamaErrorFromResponse` for non-ok responses. Added `RunningModel` and
  `OllamaVersionInfo` types.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2029 passed (215 files)**
  (+9); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 9 new tests in `ollama.test.ts` (#476): fetchRunningModels returns/empty/
  error, loadOllamaModel sends correct body + error, unloadOllamaModel sends
  keep_alive 0 + error, fetchOllamaVersion returns version + error.

## M166 — Model management slash commands: /warm /unload /running /version (#477, missing functionality) (one-hundred-twenty-ninth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2029 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Missing functionality found**: The new Ollama API functions from M165
(#476) were not wired into the UI. Codex GUI, LM Studio, and other tools let
users pre-warm models, unload them to free RAM, see which models are
loaded, and check the server version — all from the command line / chat
input. Without slash commands, the new API functions were unreachable from
the UI.

- [x] **#477** Added four slash commands to `commands.ts`:
  - `/warm <model>` — load a model into memory (5m keep-alive)
  - `/unload <model>` — unload a model from memory (free RAM)
  - `/running` — list models currently loaded in Ollama memory with size/VRAM
  - `/version` — show the Ollama server version
  Wired all four into `App.tsx` with `showStatusBanner` feedback and
  `formatErrorLine` error handling.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2034 passed (215 files)**
  (+5); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 5 new tests in `commands.test.ts` (#477): each command is registered,
  returns the correct action/arg, and appears in getAllCommands.

## M167 — Loaded model indicator in model selector (#478, missing functionality) (one-hundred-thirtieth analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2034 passed (215 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Missing functionality found**: Codex GUI, LM Studio, and other tools show
which models are currently loaded in memory (warm) directly in the model
selector. The Ollama GUI had no visual indicator for this — the user had no
way to see at a glance which models were consuming RAM/VRAM. The `/api/ps`
endpoint and slash commands were added in M165/M166 but the selector UI
didn't reflect running model state.

- [x] **#478** Added `runningModels` state (a `Set<string>` of model names
  loaded in memory). `refreshModels()` now also fetches `/api/ps` and
  populates the set. A 30-second poll keeps the indicator current. The model
  selector `<option>`s show a `●` suffix for warm models (starred, recent,
  and local Ollama groups). The `<select>` title attribute explains the
  indicator and references `/running`, `/warm`, `/unload` commands.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2037 passed (216 files)**
  (+3); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 3 new UI tests in `runningModelIndicator.test.tsx` (#478): shows ● for
  loaded models, shows no ● when none loaded, selector title explains
  the indicator.

## M168 — UI test coverage for CommandPalette and Sources components (#479, missing tests) (one-hundred-thirty-first analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2037 passed (216 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Missing tests found**: AGENTS.md requires "every feature must have a
corresponding test." The `Sources.tsx` component (inline citations UI, #120)
had zero dedicated tests, and the `CommandPalette.tsx` component had basic
tests but lacked coverage for aria attributes, hint rendering, ArrowUp
clamping, whitespace query handling, and MouseEnter selection updates.

- [x] **#479** Added `Sources.test.tsx` (10 tests): renders nothing on empty,
  collapsible summary, clickable source buttons, numbered prefixes, source
  detail display, InlineCitation rendering + aria-label, and
  renderWithCitations (marker replacement, out-of-range handling, plain text).
  Added `commandPaletteUsability.test.tsx` (8 tests): aria attributes, hint
  rendering, no-hint commands, ArrowDown×2+Enter, ArrowUp clamping, whitespace
  query, click-to-run, MouseEnter selection update.

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2055 passed (218 files)**
  (+18); `cargo test --lib` = 92 passed / 1 ignored (unchanged).
- 18 new tests across 2 new test files (#479).

## M169 — CI security-audit job fails: esbuild override + unmaintained cargo advisory (#480, failing CI) (one-hundred-thirty-second analysis pass)

Baseline: `tsc --noEmit` clean; `vitest run` = **2055 passed (218 files)**; `cargo test --lib` = 92 passed / 1 ignored.

**Failing CI found**: The `security-audit` job in `.github/workflows/build.yml`
fails. Root causes identified through local analysis (GitHub API unreachable
from sandbox):

1. **npm audit**: `package.json` had an `overrides` field pinning `esbuild` to
   `0.21.5`. npm treats `overrides` as root-level dependencies, so `npm audit
   --omit=dev --audit-level=high` still audited esbuild despite it being a
   dev-only transitive dep of vite. esbuild < 0.25.0 has a path-traversal
   advisory in the development server, which fails the `--audit-level=high`
   gate on CI (live registry). `npm audit --offline` locally showed 0 vulns
   (stale cache), masking the issue.

2. **cargo audit**: `proc-macro-error 1.0.4` is unmaintained (transitive dep of
   gtk3-macros/glib-macros). Newer `cargo-audit` versions may flag this as a
   denial depending on configuration.

- [x] **#480** Removed the `esbuild` override from `package.json` — vite
  5.4.21 already resolves esbuild to 0.21.5 via `^0.21.0`; the override was
  redundant and only caused npm audit to treat it as a root dependency.
  Added `npm ci` before `npm audit` in the CI workflow for lockfile
  consistency. Created `src-tauri/audit.toml` to suppress the
  `RUSTSEC-2024-0370` unmaintained advisory for `proc-macro-error` (safe —
  no known exploit, purely informational).

### Result
- `npx tsc --noEmit` clean; `npx vitest run` = **2055 passed (218 files)**
  (unchanged); `cargo test --lib` = 92 passed / 1 ignored (unchanged).

## M170 — CI security-audit: lopdf + quick-xml vulnerabilities; /search focus flaky on macOS (#395) (one-hundred-thirty-third analysis pass)

### Baseline
- `tsc --noEmit` clean; `vitest run` = 2055 passed (218 files); `cargo test --lib` = 92 passed / 1 ignored.
- Failing CI: `security-audit` job `cargo audit` step exited 1 with 7
  vulnerabilities; `build (macos-latest)` failed on the flaky
  `searchCommand.test.tsx` focus assertion.

### Root cause
1. `lopdf 0.41.0` — RUSTSEC-2026-0187 (stack overflow via deeply nested PDF
   objects; patched in 0.42+). lopdf 0.42/0.43/0.44 do not compile against
   modern `time` (their `datetime.rs` uses the removed
   `FormatItem::StringLiteral`); disabling lopdf's default `time` feature
   drops the datetime impl we never use and lets 0.43 build.
2. `quick-xml 0.36.2 / 0.37.5 / 0.39.4` — RUSTSEC-2026-0194 (quadratic
   runtime) and RUSTSEC-2026-0195 (memory DoS); patched only in 0.41+. The
   three copies came from our own dep, `umya-spreadsheet`, and
   `calamine`+`plist`. quick-xml 0.41 removed `BytesText::unescape()`
   (replaced by `xml10_content()`).
3. `cargo-audit` reads `.cargo/audit.toml`, not a bare `audit.toml` in the
   working directory — the prior `src-tauri/audit.toml` was never loaded, so
   its ignore list had no effect.
4. `/search` focus flakiness: the empty-state composer autofocus
   (`setTimeout(focus, 100)`) stole focus back after `/search` moved it to
   the sidebar search, racing the fixed 50ms focus timeout.

### Work
- [x] **#395** Upgraded `lopdf` 0.41.0 → 0.43 (`default-features = false`),
  `quick-xml` 0.36 → 0.41; replaced `BytesText::unescape()` →
  `xml10_content()` in `ooxml.rs`, `odf.rs`, `lib.rs`.
- [x] **#395** Upgraded `calamine` 0.35 → 0.36 and bumped the transitive
  `plist` 1.9 → 1.10, eliminating the `quick-xml` 0.39.4 copy.
- [x] **#395** Moved the audit config to `src-tauri/.cargo/audit.toml` so
  cargo-audit actually loads it; expanded the documented ignore list
  (gtk3-rs, `unic-*`, `paste`, `proc-macro-error`, `rustls-pemfile`,
  `ttf-parser`) and recorded the tracked exception for the
  `umya-spreadsheet` `quick-xml 0.37.5` copy (no upstream fix; replacement
  tracked in a follow-up issue). The two `unsound` advisories (`anyhow`,
  `glib`) are left as visible, non-fatal warnings.
- [x] **#395** Fixed the flaky `/search` focus: replaced the fixed 50ms
  timeout with a retry-based `focusElementWhenReady` helper and guarded the
  composer autofocus to only fire when nothing else is focused.

### Result
- `cargo audit` exits 0 (2 visible `unsound` warnings, non-fatal);
  `cargo test --lib` = 92 passed / 1 ignored; `tsc --noEmit` clean;
  `vitest run` = 2055 passed (218 files); `searchCommand.test.tsx` (2) green.

## M171 — Build Tauri App fails on ubuntu/windows: global [build] rustflags leaks macOS flag (#397)

### Context
Fixing #395 let the build matrix run ubuntu/windows to `Build Tauri App` (the
flaky macos test had previously `fail-fast`-cancelled them), exposing a latent
config bug.

### Root cause
`src-tauri/.cargo/config.toml` had a global `[build] rustflags` re-applying
`-C link-arg=-mmacosx-version-min=10.15` to every target. On Linux/Windows the
`cc`/`gcc` linker rejects that macOS flag, failing the release build of every
build script.

### Work
- [x] **#397** Removed the global `[build] rustflags` section; kept the
  `[target.x86_64-apple-darwin]` / `[target.aarch64-apple-darwin]` entries so
  macOS 10.15 compatibility is unchanged.

### Result
- macOS `cargo build` unchanged; `cargo audit` exit 0. ubuntu/windows
  `Build Tauri App` no longer receives the macOS linker flag.

## M172 — Build Tauri App fails on ubuntu: missing Linux system libraries (#398)

### Context
After #397 the ubuntu build reached the Rust compile and failed on missing
`gio-2.0`/`glib-2.0`/`gobject-2.0` (`pkg-config` lookups by `gio-sys`/`glib-sys`).

### Root cause
The `build` job never installed the Tauri v2 Linux system dependencies
(WebKit2GTK + GLib/GIO headers), which are not preinstalled on `ubuntu-latest`.

### Work
- [x] **#398** Added a Linux-only step (`if: matrix.os == 'ubuntu-latest'`)
  installing `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libglib2.0-dev`,
  `libgirepository1.0-dev`, `librsvg2-dev`, `libssl-dev`, `pkg-config` before
  `Build Tauri App`. macOS/Windows ship their webview SDKs.

### Result
- ubuntu `Build Tauri App` should now compile; `fail-fast` no longer cancels
  the macos/windows jobs. `security-audit` and `e2e` remain green.

## M173 — Replace umya-spreadsheet to clear quick-xml 0.37.5 DoS advisories (#396) (one-hundred-thirty-fourth analysis pass)

### Context
#395 left RUSTSEC-2026-0194/0195 as documented exceptions in `.cargo/audit.toml`
because `umya-spreadsheet 3.0.0` hard-pins the vulnerable `quick-xml 0.37.x`
with no available backport. #396 replaces that dependency so the advisories
leave the tree entirely.

### Work
- [x] **#396** Removed `umya-spreadsheet` from `Cargo.toml`.
- [x] **#396** Reimplemented `xlsx_set_cell_impl` as a surgical `zip` +
  `quick-xml 0.41` edit: sheet→part resolution via `xl/workbook.xml` + rels,
  single-cell rewrite/insert (existing, self-closing, missing cell/row),
  numeric vs inline-string typing, shared-strings preserved. Added
  `xlsx_read_cell_value` for verification.
- [x] **#396** Cleaned `.cargo/audit.toml`: removed the RUSTSEC-2026-0194/0195
  and `paste` ignores (gone from the tree); kept the `unic-*` ignores (now via
  `urlpattern`/`tauri-utils`, not umya). The two `unsound` advisories (`anyhow`,
  `glib`) stay as visible non-fatal warnings.

### Result
- `cargo audit` exit 0, **0 vulnerabilities / 0 ignored real advisories**
  (2 visible `unsound` warnings). `cargo test --lib` 97 passed / 1 ignored;
  `tsc --noEmit` clean; `vitest run` 2055 passed (218 files).

---

## Live GitHub Issues (last updated: 2026-08-23)

### Open Issues (5 total, verified via `gh` CLI and curl from api.github.com)

| # | Title | Labels | Status | Development Notes |
|---|-------|--------|--------|------------------|
| **555** | Add documentation for provider configuration in help section | documentation | open | **Priority: LOW** - Documentation update needed |
| **554** | Implement provider configuration UI and model selector | enhancement, ui | open | **Priority: MEDIUM** - UI work to group providers |
| **553** | Add configuration-based providers (Ollama, LM Studio) | enhancement | open | **Priority: MEDIUM** - Partially implemented (see below) |
| 547 | Show state inline instead of behind buttons and modal dialogs | - | open | **Priority: HIGH** - UI/UX audit finding (#547) |
| **521** | MCP OAuth success badge stored only in transient React state | bug | open | **FIXED** - Issue resolved in commit c5e2fa8 (2026-08-01) |

### Recent PRs
- #552/#551/#550: Dependabot dependency updates (src-tauri)
- #549: UI simplification initiative (project-first layout, implicit MLX)

> Note: This section is auto-updated from GitHub API. Last sync used:
> `curl -s "https://api.github.com/repos/janipasanen/ollamaGUI/issues?state=open&per_page=100"`

---

## Development Analysis (2026-08-23)

### Configuration-based Providers (#553) Status
The provider configuration system is **partially implemented**:

✅ **Completed:**
- `connections.ts` has full implementation for multiple providers (Ollama, OpenAI-compatible/ LM Studio)
- Connection persistence in localStorage with `loadConnections()` / `saveConnections()`
- Model fetching from both Ollama (`/api/tags`) and OpenAI-compatible endpoints (`/v1/models`)
- Provider headers in model selector with models grouped under each provider
- Default connections: Local Ollama (http://localhost:11434) + LM Studio (http://gx10:1234)
- API key support for authenticated endpoints

❌ **Not Implemented:**
- `config.json` file loading from project root - NOT FOUND in repository
- No code to read/write `config.json` at runtime
- No UI to manage config-based providers (only localStorage-based)

### MCP OAuth Badge Issue (#521) - RESOLVED
This issue was **fixed** in commit `c5e2fa8` (Persist and reconcile MCP auth badges against the token store):

```rust
// From mcpConfig.ts:refreshAuthFlags()
// Reconcile each HTTP server's `authenticated` badge against the real token
// store, and persist the result (#521).
```

The code now:
- Derives badge state from `tokenStore.load()` instead of hardcoding `false`
- Persists the flag via `mcpConfigStore.save()` after successful OAuth flow
- Prevents badge reset on unrelated server operations or app restarts

---

## Milestone 174 — Inline UI state, config.json, and provider system enhancements (twenty-eighth analysis pass)

A comprehensive audit and implementation pass addressing high-priority UI issues and provider configuration:

- [x] **#547** Add inline generation parameters to header. Generation params, context budget, and conversation stats are now visible at a glance without opening Settings or clicking ℹ button. Added `InlineGenParams` component showing model name, temperature, ContextBudget indicator, and structured output badge. Added `InlineConversationStats` chip in header.
- [x] **#553** Add config.json support for provider configuration. Created `projectConfig.ts` loader that reads `config.json` from project root with provider definitions (Ollama, LM Studio). Template config file created at project root with default Ollama + LM Studio gx10:1234 connection.
- [x] **#521** MCP OAuth badge issue was already fixed in commit c5e2fa8. The code reconciles `authenticated` flag against token store instead of hardcoding false, preventing reset on unrelated operations.

### Result
- `tsc --noEmit` clean; `vitest run` = **2222 passed (240 test files)**
- All inline state now visible without clicking modals
- Provider configuration supports file-based (`config.json`) and localStorage persistence
- No breaking changes to existing functionality

## Milestone 174.1 — Provider configuration UI (#554)

A dedicated provider configuration modal accessible from the Help menu:

- [x] **#554** Add `ProviderConfiguration` component with add/edit/delete for providers, enable/disable toggle, API key field support.
 - [x] **#554** Model selector groups provider models by connection. Extracted `buildModelGroups` from `App.tsx` into `services/connections.ts` as a pure, testable helper; the selector renders one <optgroup> per enabled provider (local Ollama relabeled "Local Ollama", ollama remotes as "Remote Ollama: <name>", other remotes by display name). Empty providers are kept so config.json-declared providers that expose no models still appear.

### Result
- `tsc --noEmit` clean; `vitest run` includes 10 new `buildModelGroups` tests in `test/connections.test.ts`.
- Dedicated UI for managing provider connections
- Escape handler includes provider config overlay

## M175 — Service-test coverage: citations + modelContextConfig (twenty-ninth analysis pass)

A focused test-coverage pass. The previous analysis pass (M174.1) closed the
provider/config.json gap; this pass fills the two largest uncovered service
modules. No merge to `master` — work stays on `macOS-10.15`.

- [x] **(#120)** Add unit tests for `citations.ts`. The RAG/web citation module
  had no test file. Added `src-frontend/test/citations.test.ts` covering
  `parseCitationRefs` (`[0]` ignored, `[n](url)` markdown links skipped, dedup/sort),
  `linkifyCitations` (resolves `[n]`→`CitePart`, merges adjacent text, leaves
  out-of-range/`[0]`/markdown-link literals, defaults `sources` to `[]`),
  `hasSources`, and the `openSource` system-opener via its `_mocks.open` test
  seam. 30 new tests.
- [x] **(#8 context window)** Add unit tests for `modelContextConfig.ts`, which
  had no test file. Added `src-frontend/test/modelContextConfig.test.ts` covering
  storage round-trips under the `model_context_config_v1` key, tolerance of
  corrupt JSON, `getModelContextConfig` defaults (32768 / 0.8 threshold /
  `autoDetected=false`), `setModelContextConfig` merge semantics, `removeModelContextConfig`,
  `getModelDefaultContext` (32768), `buildModelId` prefix-stripping,
  `getCompactionThreshold`, and `detectContextFromApi` (Ollama `/api/show`
  `.context_length`, OpenAI `/v1/models` fallback, null on not-ok/throw).
  22 new tests.

### Result
- `tsc --noEmit` clean.
- `vitest run` = **2310 passed (246 test files)**, +52 new tests from this
  pass (`citations.test.ts` 30, `modelContextConfig.test.ts` 22).
- One pre-existing timing-sensitive failure remains (`genStatsAndRetry.test.tsx:79`),
  flaky on slow runners and covered by CI `--retry=2`; unrelated to this work.

## M176 — Service-test coverage: promptLibrary + mcp-http (thirtieth analysis pass)

Continuing the service-coverage pass started in M175. Fills the two largest
uncovered pure-function service modules. No merge to `master` — work stays on
`macOS-10.15`.

- [x] **(#97 prompt library)** Add unit tests for `promptLibrary.ts`, which had
  no test file. Added `src-frontend/test/promptLibrary.test.ts` covering
  `loadPrompts` (empty list, corrupt-JSON tolerance, round-trip), `addPrompt`
  (uuid + timestamp + append), `updatePrompt` (partial patch, no-op on missing),
  `removePrompt` (delete, no-op on missing), and `findPrompt`. 10 new tests.
- [x] **(#21-22 MCP HTTP, #461)** Add unit tests for `mcp-http.ts`. Added
  `src-frontend/test/mcp-http.test.ts` covering `parseSseMessages`
  (single/multiple events, blank-line split, `\r\n` tolerance, multi-line
  single-object join, skipping comment/blank/non-JSON events, empty body) and
  `httpBodyErrorDetail` (fallback, string error, nested `.message`, top-level
  `message`, no-error JSON, non-JSON body). 12 new tests.

### Result
- `tsc --noEmit` clean.
- `vitest run` = **2332 passed (248 test files)**, +22 new tests from this
  pass (`promptLibrary.test.ts` 10, `mcp-http.test.ts` 12).
- One pre-existing timing-sensitive failure remains (`genStatsAndRetry.test.tsx:79`),
  flaky on slow runners and covered by CI `--retry=2`; unrelated to this work.
