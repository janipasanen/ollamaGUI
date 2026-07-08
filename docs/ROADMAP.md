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
