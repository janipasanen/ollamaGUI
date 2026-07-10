# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
#### M135 — MCP stdio `sendRequest` had no per-request timeout (#446)
- **Bug fix** (#446): `McpStdioClient.sendRequest` (mcp.ts) put a
  `{resolve, reject}` into `pendingRequests` with no timeout. If an MCP server
  accepted a JSON-RPC request but never responded, the Promise hung forever,
  blocking the agentic tool loop indefinitely. Added a per-request timeout
  (default 30 s, configurable via `McpServerConfig.timeoutMs`) that rejects
  with a descriptive error and is cleared on normal resolve/reject. 2 new tests.

#### M136 — `runAction` didn't catch sandbox errors → unhandled rejection (#447)
- **Bug fix** (#447): `runAction` (customTools.ts) called `_sandboxRun` without
  a try/catch. If the user's action code threw (syntax error, runtime error,
  timeout), the rejection propagated unhandled to the `onClick` handler in
  `App.tsx` — the user clicked an action button, nothing happened, and an
  unhandled Promise rejection was logged. Now wrapped with try/catch that logs
  and returns `null`; the `onClick` handler also catches and shows a status
  banner. 3 new tests.

#### M137 — `scenario.ts` wasted IPC on screenshots for non-visual steps (#448)
- **Bug fix** (#448): `runScenario` (scenario.ts) called `captureScreenshot()`
  before AND after every step regardless of action type. For non-`visual_match`
  steps the screenshots were stored in `StepResult` but never consumed by the
  UI. Added `captureScreenshots?: boolean` to `RunOptions` (default `false`):
  only `visual_match` steps capture by default; `true` enables all-step capture
  for debugging. 4 new/updated tests.

### Fixed
#### M138 — `executeToolCall` and safe accessors crash on malformed tool calls (#449)
- **Bug fix** (#449): `tools.ts` `executeToolCall` called
  `this.getTool(toolCall.function.name)` directly — crashes with `TypeError`
  if `function` is missing (some Ollama models send `{ name, arguments }`
  without nested `function`). `toolCallName` and `toolCallArgs` also didn't
  handle missing `function`. `App.tsx` tool call display accessed
  `toolCall.function.arguments` directly. Made `function` optional in
  `ToolCall` interface; all accessors now safely handle its absence.
  7 new tests in `tools.test.ts`.

#### M139 — `browserPreview.ts` race: follow-up calls fire before `openPreview` IPC completes (#450)
- **Bug fix** (#450): `openPreview` set `_open = true` optimistically before
  the IPC resolved. `navigatePreview`/`setBoundsPreview`/`reloadPreview` could
  fire before the webview was created, sending commands to a non-existent
  webview. Added `_openingPromise` that follow-up calls await. Added a
  generation counter so stale `openPreview` calls from previous sessions
  don't corrupt `_open` state. 4 new tests in `browserPreview.test.ts`.

### Fixed
#### M140 — `memory.ts` and `crossSessionMemory.ts` shared localStorage key with incompatible data shapes (#451)
- **Bug fix** (#451): Both modules used `'ollama_gui_memory'` as their localStorage
  key — `memory.ts` stored a `MemoryEntry[]` array, `crossSessionMemory.ts` stored
  a `Record<string, MemoryEntry>` object. When both were active (they're both
  imported by `App.tsx`), they corrupted each other's data. Gave
  `crossSessionMemory.ts` its own key `'ollama_gui_cross_session_memory'`.
  1 new test.

#### M141 — `mcpConfig.ts` `readPersisted` and `mcpAuth.ts` `authMetaStore` lacked try/catch (#452)
- **Bug fix** (#452): `readPersisted()` parsed `localStorage` without try/catch —
  corrupted data crashed the UI on startup via `mcpConfigStore.list()`. Also
  `authMetaStore.save()`/`.load()` had the same issue. Added try/catch with
  safe defaults (`[]` / `{}` / `null`) and an `Array.isArray` guard.
  6 new tests across `mcpConfig.test.ts` and `mcpAuth.test.ts`.

#### M142 — `ollama.ts` `fetchOllamaModels` had unused `includeCloudModels` parameter (#453)
- **Cleanup** (#453): Removed dead `includeCloudModels` parameter that was never
  referenced in the function body or by any caller.

### Fixed
#### M143 — `storage.ts` JSON.parse and setItem without try/catch (#454)
- **Bug fix** (#454): `getSessions()`, `getFolders()`, and `getProjects()` parsed
  `localStorage` without try/catch — corrupted data crashed the app on startup
  (the `useState` initializer calls `getProjects()` on mount). Also
  `updateSession()`, `deleteSession()`, `deleteFolder()`, and `deleteProject()`
  called `localStorage.setItem()` without `QuotaExceededError` handling, unlike
  `saveSession` which already had it. Added try/catch with safe defaults (`[]`)
  and `Array.isArray` guards to all three getters; wrapped all four mutation
  methods' `setItem` calls in try/catch. 7 new tests in `storage.test.ts`.

#### M144–M162 — Error handling hardening sweep (#455–#473)
- **Bug fixes** (#455–#468): Added `ollamaErrorFromResponse`,
  `openAiErrorFromResponse`, `oauthErrorFromResponse`, `mcpHttpErrorDetail`
  helpers across 15 service files so non-ok HTTP responses surface the server's
  error body instead of generic status text. Protected all unprotected
  `JSON.parse` calls against `SyntaxError` on malformed data. Added SSE flush
  blocks and fixed SSE parser to accept `data:` without space (spec compliance).
- **Bug fix** (#470–#471): Wrapped all 20 unprotected `localStorage.setItem`
  calls across 16 service files and 19 in `App.tsx` with `safeSetItem`.
- **Bug fix** (#472): `agenticChatStream` now pushes the assistant's
  intermediate message (content + `tool_calls`) into context before tool execution.
- **Bug fix** (#473): Added `safeSetItem` to `platform.ts`; replaced all
  `localStorage.setItem` in `App.tsx`.

#### M163–M164 — sessionStorage and crossSessionMemory quota (#474–#475)
- **Bug fix** (#474): Added `safeSessionSetItem` to `platform.ts`; protected
  `checkpoints.ts` `saveAll()` against `QuotaExceededError`. 3 new tests.
- **Bug fix** (#475): Wrapped `crossSessionMemory.ts` `saveEntries()` in
  try/catch. 2 new tests.

### Added
#### M165–M166 — Ollama model memory management API + slash commands (#476–#477)
- **Feature** (#476): Added `fetchRunningModels`, `loadOllamaModel`,
  `unloadOllamaModel`, `fetchOllamaVersion` to `ollama.ts`. 9 new tests.
- **Feature** (#477): Added `/warm`, `/unload`, `/running`, `/version` slash
  commands wired into `App.tsx`. 5 new tests.

#### M167 — Loaded model indicator in model selector (#478)
- **Feature** (#478): Model selector shows `●` badge for models loaded in
  memory, with 30s polling. 3 new UI tests.

### Fixed
#### M168 — UI test coverage for CommandPalette and Sources (#479)
- **Tests** (#479): Added `Sources.test.tsx` (10 tests) and
  `commandPaletteUsability.test.tsx` (8 tests). AGENTS.md compliance.

### Fixed
#### M117 — #file context ref always returned "(not yet indexed)" (#427)
- **Bug fix** (#427): a `#file` knowledge reference (#119) called
  `retrieve([], …)` with an empty collection-id list, so `rag.retrieve` always
  returned `[]` and every file ref fell through to the "(file not yet indexed)"
  placeholder — even for fully-indexed files. The file branch now loads the file
  record directly and injects its text (capped at 20 000 chars). 4 new tests;
  tsc clean; vitest 1841 passed.

#### M118 — @-mention token-boundary, $-content safety, subdir expansion (#428)
- **Bug fix** (#428): `isAtTrigger`/`atQuery` no longer fire on emails / mid-word
  `@` (now anchored to a token boundary — Codex/Claude parity). `resolveAtMention`
  now uses a function replacement so file content with `$&`/`$1` is inserted
  literally instead of being mangled by `String.replace` substitution.
- **Feature** (#428): `getAtOptions` now expands one level of subdirectories
  (documented but previously unimplemented), so nested files like `src/App.tsx`
  are @-mentionable. 10 new tests; tsc clean; vitest 1851 passed.

#### M119 — expandTemplate $-injection + draft-persistence test flake (#429, #430)
- **Bug fix** (#429): `expandTemplate` no longer corrupts slash-command
  arguments containing `$` (e.g. `$&` re-inserted the matched token, `$5`
  became empty, and `$N` inside expanded args was re-substituted). Now uses
  function replacements and substitutes `$1`…`$N` before `$ARGUMENTS`.
- **Test fix** (#430): the draft-persistence UI test no longer times out under
  parallel-suite load (15 s test timeout, 3 s `waitFor`). 4 new tests; tsc clean;
  vitest 1855 passed.

#### M120 — ComfyUI image generation broken at /view binary fetch (#431)
- **Bug fix** (#431): `generateComfyUI` (#130) always failed when an image was
  ready — it fetched the binary PNG from `/view` as text and called `btoa()`,
  which throws on out-of-Latin1 code points (and the Rust `mcp_http_request`
  .text() corrupts binary). Added a Rust `http_get_binary` command returning
  base64 and a TS `httpGetBase64` helper (fetch→Blob→FileReader fallback).
  3 new TS tests + 2 cargo tests; tsc clean; vitest 1858 passed; cargo 89 passed.

#### M121 — rewind_checkpoint bypassed the diff-review approval gate (#432)
- **Bug fix** (#432): the `rewind_checkpoint` agent tool overwrote files via
  `writeFile` directly, bypassing the diff-review gate that `write_file` /
  `apply_edit` / `apply_patch` all enforce. `rewindToCheckpoint` now routes
  through `proposeEdits` (batch review); autonomous mode is unchanged. 3 new
  tests; tsc clean; vitest 1861 passed.

#### M122 — Workspace RAG never indexed .env.example / multi-dot text files (#433)
- **Bug fix** (#433): `isTextFile` reduced `.env.example` to `.example` via
  `slice(lastIndexOf('.'))`, so the `.env.example`/`.gitignore` entries in
  `TEXT_EXTENSIONS` were dead and those files were never indexed. Now also
  matches the whole lowercased filename. 6 new tests; tsc clean; vitest 1867
  passed.

#### M123 — Visual diff silently passed when screenshots failed to decode (#434)
- **Bug fix** (#434): `diffScreenshots` returned `pass: true` when a screenshot
  failed to decode, silently passing visual regression. A load failure is now a
  2 new tests; tsc clean; vitest 1869 passed.

#### M124 — MCP HTTP IPC deserialization broken (camelCase mismatch) (#435)
- **Bug fix** (#435): `McpHttpRequest` in `src-tauri/src/lib.rs` had
  snake_case fields with no `#[serde(rename_all = "camelCase")]`, so every
  `mcp_http_request` invoke that sent camelCase keys (`sessionId`,
  `authToken`) failed to deserialize — breaking all HTTP MCP servers in
  production. OpenAPI/image-gen calls that omitted `sessionId` also failed,
  silently falling back to browser `fetch` (CORS). Added
  `#[serde(rename_all = "camelCase")]` + `#[serde(default)]` on
  `session_id`. 1 new cargo test; tsc clean; vitest 1869 passed; cargo 90 passed.

#### M125 — MCP stdio transport silently ignored success:false from spawn (#436)
- **Bug fix** (#436): `TauriMcpStdioTransport.spawnProcess` never checked
  `result.success` from the Rust `mcp_stdio_spawn` response. A soft failure
  (duplicate session → `success: false`) was silently treated as success,
  causing confusing timeouts or 'Session not found' errors later. Now throws
  with the response message. 15 new direct unit tests for `mcp-tauri.ts`;
  tsc clean; vitest 1884 passed.

#### M126 — openPreview stale _open on rejection + CliCommandRequest/Response camelCase (#437)
- **Bug fix** (#437): `openPreview` set `_open = true` optimistically before
  the IPC; on rejection the flag stayed true, so navigate/setBounds/reload
  sent commands to a non-existent webview. Now resets `_open = false` on
  rejection. Also added `#[serde(rename_all = "camelCase")]` to
  `CliCommandRequest`/`CliCommandResponse` (latent same-class-as-#435 bug).
  3 new TS tests + 1 cargo test; tsc clean; vitest 1887 passed; cargo 91 passed.

#### M127 — Browser scenario click/type sent ref_id (snake_case) to Tauri (#438)
- **Bug fix** (#438): `scenario.ts` called `browser_cdp_click` and
  `browser_cdp_type` with `ref_id` (snake_case) but Tauri expects `refId`
  (camelCase) — breaking all click/type steps in browser scenarios in production.
  Now sends `refId`. 3 new tests; tsc clean; vitest 1890 passed.

#### M128 — terminal_run used sh -c on all platforms, broken on Windows (#439)
- **Bug fix** (#439): `terminal_run` hardcoded `sh -c` with no
  `#[cfg(windows)]` branch, so the terminal panel failed on Windows where
  `sh` is not in PATH. Now uses the same `cfg(unix)`/`cfg(windows)` split
  as `run_cli` (`sh -c` / `cmd /C`). tsc clean; cargo 91 passed.

#### M129 — expandTemplate only replaced the first $ARGUMENTS occurrence (#440)
- **Bug fix** (#440): `expandTemplate` used `replace` for `$ARGUMENTS`
  (first occurrence only) while `$1`/`$2` used `replaceAll`. A
  user-defined template with `$ARGUMENTS` twice would leave the second as
  literal text. Now uses `replaceAll`. 2 new tests; tsc clean; vitest 1892 passed.

#### M130 — Scenario visual_match overwrote pre-defined after + double-ran diff (#441)
- **Bug fix** (#441): `runScenario` overwrote `step.args.after` with
  `undefined` in the enriched step, discarding any pre-defined reference
  screenshot. It also always re-ran the diff with captured screenshots,
  overriding `executeStep's` result. Now preserves `step.args.after`,
  `executeStep` returns `diffRatio`, and the runner only re-runs when no
  reference is provided. 2 new tests; tsc clean; vitest 1894 passed.

#### M131 — terminal_kill sent session_id (snake_case) to Tauri (#442)
- **Bug fix** (#442): `terminal.ts` called `terminal_kill` with
  `session_id` (snake_case) but Tauri expects `sessionId` (camelCase) —
  breaking the terminal Kill button in production. Also added
  `#[serde(rename_all = "camelCase")]` to `McpStdioResponse` (last
  snake_case response struct). 1 new TS test + 1 cargo test; tsc clean;
  vitest 1895 passed; cargo 92 passed.

#### M132 — Agent tool call dedup dropped all id-less calls after the first (#443)
- **Bug fix** (#443): `agenticChatStream` deduplicated tool calls by
  `tc.id === toolCall.id`, but `id` is optional. When a model sent multiple
  tool calls without `id`, `undefined === undefined` was true, so only the
  first was kept — all others were silently dropped. Now uses a composite
  fallback key (`name:arguments`) when `id` is missing. 2 new tests;
  tsc clean; vitest 1897 passed.

#### M133 — Ollama stream parser lost JSON lines split across chunks (#444)
- **Bug fix** (#444): `fetchOllamaChatStream`, `agenticChatStream`,
  `pullOllamaModel`, and `createOllamaModel` split the stream by newline
  without buffering incomplete lines. A JSON line split across TCP packets
  would fail to parse and be silently lost. All four now use a buffer
  accumulator (matching the MLX parser pattern). 3 new tests; tsc clean;
  vitest 1900 passed.

#### M134 — Agent catch block crashed on malformed tool call (#445)
- **Bug fix** (#445): `agenticChatStream` catch block accessed
  `toolCall.function.name` directly, crashing with a TypeError when
  `function` was missing (some Ollama models omit it). Now uses
  `toolCallName(toolCall)` with a `toolCall.name` fallback. 6 new tests
  for `toolCallName`/`toolCallArgs`; tsc clean; vitest 1906 passed.

#### M113 — Disabled-tool execution enforcement (#423)
- **Bug fix** (#423): a per-tool disable (#399) now blocks execution, not just
  the request payload — the agentic loop refuses to run a tool excluded from
  the active `toolFilter` even if the model returns a call to it.
- 3 new tests; tsc clean; vitest 1839 passed.

### Tests
#### M116 — Stabilise flaky MCP connection-error e2e test (#426)
- **Test fix** (#426): the e2e "MCP connection errors" test flaked because the
  blanket `fetch` mock made the "unreachable" server sometimes connect (green).
  The test now rejects only the MCP URL and asserts the red error dot
  specifically. 5/5 isolated runs green at ~1.8 s (was 5–8 s); no production
  change.

#### M115 — Stabilise flaky CLI approval keyboard tests (#425)
- **Test fix** (#425): the three CLI-approval keyboard UI tests (Enter/Escape/A,
  #361) flaked ~20% from a post-paint `useEffect` race — the keydown fired before
  the listener attached. Keydowns now retry inside `waitFor` until the modal
  closes. 8/8 isolated runs green; no production change.

#### M114 — Many-models fan-out tests (#126 / #424)
- **Coverage** (#424): added `manyModels.test.ts` (14) — `hasSameHostConflict`,
  `groupByHost`, and `runManyModels` (sequential same-host, parallel
  different-host, abort, error state, OpenAI routing + reasoning passthrough).
  tsc clean; vitest 1837 passed (214 files), +14 over the 1823 baseline.

#### M112 — Scroll-to-bottom button click→scroll UI test (#422)
- **Coverage** (#422): added `scrollButton.test.tsx` (1) — the button appears
  when scrolled up and clicking it scrolls to the latest message and hides it.
- 1 new test; tsc clean; vitest 1836 passed.

#### M111 — Up-arrow quick-edit last user message UI tests (#421)
- **Coverage** (#421): added `upArrowEdit.test.tsx` (2) — ArrowUp opens inline
  edit on the last user message and re-sends the edit; ignored while
  generating (#267).
- 2 new tests; tsc clean; vitest green.

#### M110 — Prompt history recall UI tests (#420)
- **Coverage** (#420): added `promptHistory.test.tsx` (2) — Alt+Up/Alt+Down
  recall navigation + slash commands excluded from history (#332).
- 2 new tests; tsc clean; vitest 1835 passed.

#### M109 — Continue-generation click + regenerate-with-model UI tests (#418, #419)
- **Coverage** (#418/#419): clicking Continue on a cancelled reply resumes and
  clears the note; the regenerate-with-model ↺▾ menu lists models and
  regenerates with the chosen model.
- 2 new tests; tsc clean; vitest green.

#### M108 — Message queue UI tests (#417)
- **Coverage** (#417): added `messageQueue.test.tsx` (2) — enqueue while
  streaming + FIFO auto-send on completion, and remove-before-send.
- 2 new tests; tsc clean; vitest green.

#### M107 — MCP pure helpers + server-manager registry tests (#416)
- **Coverage** (#416): added `mcp.test.ts` (12) — `normalizeToolsList` mapping
  and the transport-free `McpServerManager` registry methods (add/get/upsert/
  remove/active-ids/unknown-connect).
- 12 new tests; tsc clean; vitest 1833 passed.

#### M106 — LibreOffice onboarding persistence tests (#415)
- **Coverage** (#415): added `libreOfficeOnboarding.test.ts` (9) via the
  `_store` seam — default/round-trip/dismiss/path/corruption/needsOnboarding.
- 9 new tests; tsc clean; vitest 1821 passed.

#### M105 — KnowledgeDB in-memory store unit tests (#414)
- **Coverage** (#414): added `db.test.ts` (10) for `createMemoryKnowledgeDB` —
  the KnowledgeDB contract (collections + files CRUD, filtering, scope, instance
  isolation) that rag.ts / knowledge.ts rely on.
- 10 new tests; tsc clean; vitest 1812 passed.

#### M104 — MCP preset catalog integrity tests (#413)
- **Coverage** (#413): added `mcpPresets.test.ts` (9) — unique keys, required
  fields, transport/command/url sanity, deprecated entries carry a security
  note, getMcpPreset lookup, secret env-field flagging.
- 9 new tests; tsc clean; vitest 1802 passed.

#### M103 — mcpConfig store unit tests (#412)
- **Coverage** (#412): added `mcpConfig.test.ts` (12) for the security-sensitive
  MCP config store — env-value blanking in localStorage, keychain storage /
  rehydration, delete purging, auto-reconnect eligibility (#55), id generation.
- 12 new tests; tsc clean; vitest 1793 passed.

#### M102 — systemPrompt + structuredOutput unit tests (#411)
- **Coverage** (#411): added tests for two core untested modules —
  `systemPrompt.ts` (composeSystemPrompt ordering/trimming/empty-sources) and
  `structuredOutput.ts` (schema parsing, JSON-Schema conformance, response
  classification). AGENTS.md requires every feature to have a test.
- 20 new tests; tsc clean; vitest 1781 passed.

### Added
#### M101 — Cancel unblocks approval-waiting runs (#410)
- **Bug fix** (#410): Stop now denies any pending approval (CLI / tool / plan)
  and closes the modal instead of hanging the run while the agent awaited an
  approval promise that the AbortSignal alone couldn't resolve.
- 1 new test; tsc clean; vitest 1761 passed.

#### M100 — Plan edit-before-approve (#409)
- **Plan-edit parity** (Codex, #409): the plan-approval modal now has an "Edit
  plan" toggle to rewrite the proposed steps before approving; edits persist
  to the plan panel (statuses preserved).
- 1 new test; tsc clean; vitest 1760 passed.

#### M99 — Plan-mode gating: approve plan before execution (#408)
- **Plan-mode parity** (Codex/Claude, #408): `isPlanMode()` is now wired in. In
  plan autonomy, the agent publishes a plan (read-only `update_plan`) freely,
  then mutating tools are blocked behind a plan-approval modal; after approval
  the plan executes without per-tool prompts for the rest of the run. Approve /
  Deny buttons + Enter/Escape shortcuts; resets each run.
- 2 new tests; tsc clean; vitest 1759 passed.

#### M98 — Tool approval keyboard shortcuts + Escape fix (#407)
- **Approval parity** (Codex/Claude, #407): the agent tool approval modal now
  has keyboard shortcuts (Escape=Deny, Enter=Allow, A=Allow for session), and
  Escape no longer aborts the whole run while an approval modal is open (also
  fixes the latent CLI-approval Escape double-action).
- 2 new tests; tsc clean; vitest 1757 passed.

#### M97 — Tool approval "Allow for session" (#406)
- **Approval parity** (Codex/Claude "don't ask again", #406): the agent tool
  approval modal now has an "Allow for session" button that auto-approves
  subsequent calls to the same tool without re-prompting (session-only, not
  persisted — matching the CLI `cliAllowlist`).
- 1 new test; tsc clean; vitest 1755 passed.

#### M96 — Agentic clean abort / cancel-keep-partial (#405)
- **Agentic Stop** (Codex/Claude parity, #405): aborting an agentic run
  mid-fetch no longer surfaces an `Error: aborted` banner. The agentic loop's
  outer catch now classifies an abort and fires `onCancel`, which marks the
  partial assistant reply `*(generation cancelled)*` + `wasCancelled` (matching
  the normal streaming cancel-keep-partial #257/#303). Non-abort errors still
  fire `onError`.
- 4 new tests; tsc clean; vitest 1754 passed.

#### M95 — secrets.ts keychain wrapper tests (#404)
- **Keychain wrapper coverage** (#404): added `secrets.test.ts` covering the
  `secrets.ts` wrapper (Tauri `secret_set/get/delete` mapping + localStorage
  `(service, key)` ref tracker, dedupe, null handling, corruption resilience,
  round-trip). Reconciled stale ROADMAP checkboxes (#224–#228 all already done).
- 8 new tests; tsc clean; vitest 1750 passed.

#### M94 — Agentic "Continue" past max-iterations (#403)
- **Continue agent** (Codex/Claude parity, #403): when the agentic loop hits
  `maxIterations` without a final answer, a `▶ Continue agent` button appears
  under the stop warning and re-runs the agentic turn with the current context
  (no new user message). The max-iterations warning is now surfaced to the UI
  from the generator yield, and `agentHitMax` persists past `onComplete`.
- 3 new tests; tsc clean; vitest 1742 passed.

#### M93 — /gitundo revert last agent auto-commit (#402)
- **`/gitundo`** (Aider `/undo` parity, #402): reverts the most recent agent
  auto-commit by hard-resetting `HEAD~1`, but only when the last commit subject
  starts with the `ollama-gui:` auto-commit prefix (refuses to touch user commits).
  Added a Rust `git_reset` command, a `gitReset` frontend helper, an
  `undoLastAutoCommit()` service, and the `/gitundo` slash command. Non-fatal when
  there is no workspace, no commits, or git fails.
- 10 new tests; tsc clean; `cargo check` clean; vitest 1739 passed.

#### M92 — Auto-commit after agentic edits (#401)
- **Auto-commit edits** (Aider parity, #401): opt-in setting that stages &
  commits each applied file edit (`write_file` / `apply_edit` / `apply_patch`) to
  the workspace git repo with a `ollama-gui: <label> — <path>` message. Added an
  `autoCommit` service, an `EditAppliedCallback` in `diffReview.ts` fired after
  every successful apply, and an "Auto-commit edits" toggle in Settings. Off by
  default; no-workspace / not-a-repo / git failures are non-fatal.
- 12 new tests; tsc clean; vitest 1729 passed.

#### M91 — Combined batch diff review for multi-file apply_patch (#400)
- **Batch diff review** (Codex GUI / Cursor parity, #400): when `apply_patch` carries
  several file operations, all update/create ops are now presented in a single
  multi-file review instead of N sequential popups. Added `proposeEdits` +
  `setBatchReviewCallback` in `diffReview.ts` (falls back to the single-edit
  callback per edit when no batch callback is set), routed `apply_patch` through
  one batch review, and a new `DiffReviewBatchModal` with per-file Accept/Reject,
  Accept All / Reject All, and Enter/Esc shortcuts. Single-op patches keep the
  existing single-edit flow.
- 13 new tests; tsc clean; vitest 1717 passed.

#### M90 — Agentic step progress & per-tool enable/disable (#398–#399)
- **Agentic step/iteration progress** (Codex CLI / Claude Code parity, #398): the
  agent loop now fires `onIteration(iteration, maxIterations)` at the start of each
  loop turn, and the header agent-status badge shows "Step N/M" alongside the
  phase label ("Thinking…" / "Running: <tool>") during agentic generation.
- **Per-tool enable/disable** (Claude Code parity, #399): a new `toolConfig` service
  persists a disabled-tool set to localStorage. The main agentic call passes a
  `toolFilter` (only when some tool is disabled, so default behaviour is unchanged).
  Each tool in the Settings "Available Tools" listing gets a toggle switch, and a
  `/tools` slash command lists every registered tool with an enabled count.
- 15 new tests; tsc clean; vitest 1704 passed.

#### M89 — Agentic loop robustness & multi-file edit parity (#395–#397)
- **PostToolUse hooks** (Claude Code parity, #395): a parallel post-tool hook
  registry (`registerPostToolUseHook` / `runPostToolUseHooks`) runs after every
  tool execution and can `transform` (e.g. redact secrets via `makeRedactHook`)
  or `block` the output before it reaches the model. The UI still shows the full
  original tool result.
- **Tool-output truncation** (Codex / Claude / Cursor parity, #396): tool results
  fed to the model context are now capped at `MAX_TOOL_OUTPUT_CHARS` (20 000) with
  a trailing `[output truncated: N chars omitted]` notice, so a large `cat`, test
  run or `read_file` can no longer blow the context window. The chat UI keeps the
  full output.
- **Multi-file `apply_patch` tool** (Codex CLI parity, #397): a new `apply_patch`
  tool applies an ordered `operations` array (`update` / `create` / `delete`) in
  one shot; each update/create routes through the existing inline diff review and
  a new Rust `delete_file` command backs the delete op. Returns a per-op summary.
- 16 new tests; tsc clean; vitest 1689 passed; `cargo check` clean.

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

### Fixed
#### M169 — CI security-audit job fails: esbuild override + unmaintained cargo advisory (#480)
- **Bug fix** (#480): Removed redundant `esbuild` override from `package.json`
  that caused `npm audit --omit=dev --audit-level=high` to fail on CI. The
  override pinned esbuild to 0.21.5 at the root level, bypassing `--omit=dev`
  exclusion. esbuild < 0.25.0 has a path-traversal advisory in the dev server.
  Vite 5.4.21 already resolves esbuild to 0.21.5 via `^0.21.0`, so the override
  was unnecessary. Added `npm ci` before `npm audit` in the CI workflow for
  lockfile consistency. Created `src-tauri/audit.toml` to suppress the
  `RUSTSEC-2024-0370` unmaintained advisory for `proc-macro-error` (transitive
  dep of gtk3-macros — no known exploit, purely informational).

#### M170 — CI security-audit: lopdf + quick-xml vulnerabilities; /search focus flaky on macOS (#395)
- **Bug fix** (#395): `cargo audit` reported 7 vulnerabilities. Upgraded the
  affected crates: `lopdf` 0.41.0 → 0.43 (default-features off — drops the
  unmaintained-`time` datetime impl we never use, fixing RUSTSEC-2026-0187
  stack-overflow), `quick-xml` 0.36 → 0.41 (fixes RUSTSEC-2026-0194/0195 for our
  own usage). Replaced the removed `BytesText::unescape()` API with
  `xml10_content()` in `ooxml.rs`, `odf.rs`, `lib.rs`.
- **Bug fix** (#395): Eliminated the second vulnerable `quick-xml` 0.39.4 copy
  by upgrading `calamine` 0.35 → 0.36 and bumping the transitive `plist`
  1.9 → 1.10 (both now resolve to the patched 0.41 line).
- **Bug fix** (#395): The remaining `quick-xml` 0.37.5 copy comes only from
  `umya-spreadsheet 3.0.0` (hard-pins `^0.37.1`; no 0.37.x backport exists).
  It cannot be upgraded without replacing umya-spreadsheet — tracked in a
  follow-up issue. Documented as a tracked exception in `.cargo/audit.toml`.
- **Bug fix** (#395): `cargo-audit` reads `.cargo/audit.toml`, not a bare
  `audit.toml` in the working dir — the prior `src-tauri/audit.toml` was never
  loaded. Moved the config to `src-tauri/.cargo/audit.toml` and expanded the
  ignore list (gtk3-rs bindings, `unic-*`, `paste`, `proc-macro-error`,
  `rustls-pemfile`, `ttf-parser`; the two `unsound` advisories — `anyhow`,
  `glib` — are intentionally left visible as non-fatal warnings).
- **Bug fix** (#395): `searchCommand.test.tsx` was flaky on macOS CI. The
  empty-state composer autofocus (`setTimeout(..., 100)`) stole focus back
  after `/search` moved it to the sidebar search. Replaced the fixed 50ms
  focus timeout with a retry-based `focusElementWhenReady` helper and guarded
  the composer autofocus to only fire when nothing else is focused.
- **Tests**: `searchCommand.test.tsx` (2) now passes reliably; `cargo audit`
  exits 0; `cargo test --lib` 92 passed / 1 ignored; `tsc --noEmit` clean;
  `vitest run` 2055 passed (218 files).

#### M171 — Build Tauri App fails on ubuntu/windows: global `[build]` rustflags leaks macOS flag (#397)
- **Bug fix** (#397): `src-tauri/.cargo/config.toml` had a global `[build]`
  `rustflags = ["-C", "link-arg=-mmacosx-version-min=10.15"]` that applied the
  macOS linker flag to every target, so `gcc`/`cc` rejected
  `-mmacosx-version-min=10.15` and `Build Tauri App` failed on Linux/Windows.
  Removed the redundant global section — the per-target `[target.*-apple-darwin]`
  entries already cover macOS. The bug was previously masked by the `fail-fast`
  matrix cancelling ubuntu/windows once `build (macos-latest)` failed (the #395
  flaky test); fixing #395 let ubuntu/windows reach `Build Tauri App` and expose
  it.
- **Tests**: macOS `cargo build` unaffected (per-target flags intact);
  `cargo audit` exit 0.

#### M172 — Build Tauri App fails on ubuntu: missing Linux system libraries (#398)
- **Bug fix** (#398): The `build` job never installed the Tauri v2 Linux system
  dependencies, so `gio-sys`/`glib-sys`/`gobject-sys` failed `pkg-config`
  lookups (`gio-2.0`/`glib-2.0`/`gobject-2.0` not found) and `Build Tauri App`
  failed on `ubuntu-latest`. Added a Linux-only step installing
  `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libglib2.0-dev`,
  `libgirepository1.0-dev`, `librsvg2-dev`, `libssl-dev`, `pkg-config`. macOS/
  Windows already ship their webview SDKs. Previously masked by earlier
  failures (#395/#397) and `fail-fast` matrix cancellation.
