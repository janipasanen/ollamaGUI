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
