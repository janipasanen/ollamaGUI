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

- [ ] **#224** Add Ollama API error-handling, timeout & abort-signal tests.
  `ollama.ts` already throws on non-`ok` and accepts `AbortSignal`, but
  `ollama.test.ts` has no error/timeout/abort cases. AGENTS.md explicitly
  requires Ollama error-handling + timeout tests.
- [ ] **#225** Add unit tests for the secrets keychain wrapper
  (`secret_set/get/delete/listRefs`). Security-sensitive, used by `App.tsx`,
  currently untested (`secretStore.ts` is a different, already-tested module).
- [ ] **#226** Add unit tests for `orchestrator.ts` `runCloudBrainLocalWorker`
  (brain-plan / worker / brain-final). Imported by `App.tsx` + `mlx.ts`, no
  test file, not imported by any existing test.
- [ ] **#227** Remove the dead Tauri `greet` template stub
  (`lib.rs:227` + its `generate_handler!` entry). Not invoked anywhere in the
  frontend — leftover `cargo tauri init` scaffold.
- [ ] **#228** Complete the keyboard-shortcuts help overlay. `Ctrl+B` / `Ctrl+F`
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
