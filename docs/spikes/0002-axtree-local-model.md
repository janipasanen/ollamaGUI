# Spike 0002 — AX-tree vs. vision reliability gate for LOCAL Ollama models

- **Issue:** #67 — SPIKE: validate that an accessibility-tree `ref=eNN` page model is
  reliable enough to be the **primary** action-targeting mechanism for the **local**
  models we ship, before the XL browser-automation engine (#73) is built.
- **Status:** Methodology + go/no-go rubric recorded. Result cells to be filled on a
  throwaway branch by running the harness. **No engine code is built by this spike.**
- **Gates:** ADR-0001 open-risk (b). The XL engine (#73) MUST NOT be built until this
  gate resolves GO (or GO-with-vision-fallback).
- **Decision owner:** browser-automation track.

This spike is **decision-oriented and throwaway**. It exists to answer one question with
data from *our* local models, not to ship anything:

> Can a hand-serialized AX-tree outline with short `ref=eNN` handles drive a local
> Ollama model to click the right button / fill the right field reliably enough to be
> the primary targeting model — or must targeting be vision-driven?

ADR-0001 currently records this as an **unvalidated assumption** ("we assume the AX-tree
`ref=eNN` model is reliable enough … with screenshots as a visual-assert supplement").
This spike replaces that assumption with measured success rates.

---

## 1. Why this gate exists

The automation engine design hinges on **how the model perceives and targets a page**:

- **AX-tree targeting (assumed primary):** the page is serialized to a compact text
  outline where every actionable node carries a stable `eNN` ref (mirrored in
  `BrowserState.lastSnapshotRefs`, see `src-frontend/services/browser.ts`). The model
  emits a tool call like `click({ ref: "e4" })`. Cheap in tokens, deterministic to map
  back to a DOM node, no image encoding, works on text-only local models.
- **Vision targeting (fallback):** the page is screenshotted and the model points at
  pixels / describes the target. Works only on vision-capable models
  (`modelSupportsVision`, `ollama.ts:140`), costs far more tokens, and is slower.

Frontier hosted models handle AX-tree targeting well. The **open risk** is the *local*
models ollamaGUI ships against (small quantized 3B–8B-class models): they may hallucinate
refs, pick the wrong ref, or ignore the outline entirely. If AX targeting is unreliable on
those models, the engine must pivot to vision-first targeting — a very different, heavier
design. We must know **before** building #73.

---

## 2. Fixture — fixed login-form page

A single, deterministic fixture so every trial is identical across models and runs. Use a
`data:` HTML URL (no network, no flake, embeddable directly in the harness):

```
data:text/html,<!doctype html><html><body>
  <h1>Sign in</h1>
  <form>
    <label for="u">Username</label>
    <input id="u" name="username" type="text" />
    <label for="p">Password</label>
    <input id="p" name="password" type="password" />
    <button id="go" type="submit">Log in</button>
    <a id="forgot" href="#">Forgot password?</a>
  </form>
</body></html>
```

This fixture is intentionally minimal but contains the four node classes that matter:
a **text input**, a **password input** (which the engine must redact/write-gate via
`isSecret`, per ADR-0001), a **submit button**, and a **link** (a distractor so "click the
button" can be scored against a wrong-but-plausible target).

### Hand-serialized AX outline (`ref=eNN`)

The harness hand-serializes the fixture to the exact outline shape the engine will use.
Refs are **short integers prefixed `e`** (a mitigation, see §6) and only **actionable**
nodes get refs; landmarks are bare context lines:

```
# Sign in                       (heading)
form
  textbox "Username"      ref=e1
  textbox "Password"      ref=e2   (secret)
  button  "Log in"        ref=e3
  link    "Forgot password?" ref=e4
```

The `(secret)` marker on `e2` mirrors the engine's redaction/write-gate contract. The
serializer used by the harness is the same conceptual function the engine will own; here it
is a fixed string so the *input is constant* and only the *model* varies.

---

## 3. Method — drive local models via the existing tool-calling path

Reuse the real code path the engine will use, so the spike measures what production would
see, not a toy:

- **Streaming + tool calls:** `fetchOllamaChatStream(model, messages, onChunk, endpoint,
  isCloudModel, options, signal, format)` (`ollama.ts:47`). Tool-call deltas arrive on the
  streamed `message.tool_calls`; the harness accumulates them exactly as the agent loop does.
- **Tool schema:** register throwaway `click` and `type` tools through
  `toolRegistry.registerTool({ name, description, parameters, readOnly, execute })` and feed
  their schemas to the model via `getOllamaToolDefinitions()` (`tools.ts:54`), which forwards
  `tool.parameters` verbatim. Schemas:
  - `click({ ref: string })` — `parameters.properties.ref` is a string; `required: ["ref"]`.
  - `type({ ref: string, text: string })` — `required: ["ref","text"]`.
  - Mark both `readOnly: false`; the spike harness does not actually mutate a page, it only
    records the `(ref, text?)` the model chose.
- **Prompt:** a fixed system message describing the ref contract ("target elements only by
  their `ref`; never invent a ref that is not in the outline") + the AX outline as a user
  message + the task instruction.
- **Tasks (alternated across trials):**
  1. *"Click the Log in button."* → expected `click({ ref: "e3" })`.
  2. *"Type `alice` into the Username field."* → expected `type({ ref: "e1", text: "alice" })`.
- **Trials:** ~10 per task per model (≈20 calls/model). Fix `temperature` low (e.g. 0.0–0.2)
  for the primary pass; optionally repeat one model at higher temperature to observe
  ref-hallucination sensitivity.
- **Models — representative LOCAL set (3 tiers):** pick from what `fetchOllamaModels`
  reports locally, e.g.
  - a small instruct model (~3B, e.g. `llama3.2:3b`),
  - a mid instruct model (~7–8B, e.g. `qwen2.5:7b` / `mistral:7b`),
  - one tool-tuned model if available (e.g. a `*-tools` / function-calling variant).
- **Vision variant:** for vision-capable models only (gate on `modelSupportsVision`,
  `ollama.ts:140`), repeat the same two tasks but instead of the AX outline, pass a
  screenshot of the fixture as a base64 entry in the message `images?: string[]` field
  (`Message`, `ollama.ts:8`) and ask the model to name the target (then map its answer to a
  ref for scoring). This isolates **AX vs. vision on the same model and same fixture**.

### Scoring (per trial)

A trial is recorded as one of:

- **success** — the model emitted the *correct* tool with the *correct* ref (and, for
  `type`, the correct field; text content is scored leniently).
- **wrong-ref** — a valid ref from the outline, but the wrong one (e.g. clicked `e4` link
  instead of `e3` button).
- **hallucinated-ref** — a ref not present in the outline (e.g. `e9`, `e0`, `button-1`).
- **ignored-outline** — no tool call, or targeting by CSS/text/coordinates instead of a ref.
- **wrong-tool** — `type` when `click` was asked, or vice versa.

Also capture, per trial: **prompt tokens** and **completion tokens** (from the final
streamed chunk's `prompt_eval_count` / `eval_count`) so AX vs. vision token cost is
comparable.

---

## 4. Results table — fill after running

Aggregate per model. "AX success" / "Vision success" are success-rate fractions over the
~10 trials (or ~20 if both tasks are pooled). Token columns are mean per call. Vision cells
are **N/A** for text-only models.

| Model | Param/quant | AX success | Vision success | AX prompt tok | AX completion tok | Vision prompt tok | Dominant failure mode(s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _(small ~3B)_ |  |  |  |  |  |  |  |
| _(mid ~7–8B)_ |  |  |  |  |  |  |  |
| _(tool-tuned)_ |  |  |  |  |  |  |  |
| _(vision-capable)_ |  |  |  |  |  |  |  |

### Failure-mode tally (fill after running)

| Model | wrong-ref | hallucinated-ref | ignored-outline | wrong-tool | Notes |
| --- | --- | --- | --- | --- | --- |
| _(small ~3B)_ |  |  |  |  |  |
| _(mid ~7–8B)_ |  |  |  |  |  |
| _(tool-tuned)_ |  |  |  |  |  |
| _(vision-capable)_ |  |  |  |  |  |

---

## 5. Go / no-go rubric

Apply to the **best representative local model** we would realistically ship the engine
against (not the best frontier model, and not the worst toy model):

| AX success rate (best shipped local model) | Decision |
| --- | --- |
| ≥ 0.90 | **GO — AX-tree primary.** Build #73 with `ref=eNN` targeting as the primary path; screenshots stay a *visual-assert supplement* only, exactly as ADR-0001 assumes. |
| 0.70 – 0.89 | **GO with mitigations + retry.** AX stays primary but the engine MUST ship the §6 mitigations (short refs, fewer landmark lines, retry-on-bad-ref) and SHOULD add an automatic vision fallback for vision-capable models after N failed AX attempts. |
| 0.50 – 0.69 | **CONDITIONAL / vision-assist.** AX is too weak alone on local models. Engine design pivots so vision targeting is co-primary on vision-capable models, and AX is a hint, not the source of truth. Re-spike after mitigations before committing to the XL build. |
| < 0.50 | **NO-GO for AX-primary.** Do not build #73 on an AX-first design. Either require a vision-capable local model for automation (and gate the feature on `modelSupportsVision`) or defer automation until a stronger local model is the baseline. |

Secondary gates that can downgrade a GO:

- **Hallucinated-ref rate > 15%** on the best shipped model → treat as at most "GO with
  mitigations"; ref hallucination is the most dangerous failure (it can target the wrong DOM
  node silently). Retry-on-bad-ref (§6) becomes mandatory.
- **Vision success ≫ AX success on the same vision model** (e.g. +20pp) → record a strong
  recommendation to make vision the default for vision-capable models even if AX clears the
  bar for text-only models.

---

## 6. Mitigations to feed the engine (#73)

These are the levers the spike exists to validate; each is a concrete engine requirement if
the rubric lands in the "GO with mitigations" or "CONDITIONAL" band:

1. **Short integer refs (`e1`, `e2`, …).** Small models track short tokens better than long
   opaque IDs. The serializer must emit `eNN` where `NN` is a small running integer, not a
   hash or DOM path. (Already reflected in the fixture outline above.)
2. **Fewer landmark lines.** Only **actionable** nodes get refs and lines; structural/ARIA
   landmarks are collapsed to minimal context. A shorter outline reduces both token cost and
   the chance the model picks a non-actionable line. Measure the token delta of a verbose vs.
   pruned outline if time permits.
3. **Retry-on-bad-ref.** When the model returns a ref that is **not** in
   `lastSnapshotRefs` (hallucinated) or targets a non-actionable node, the engine must NOT
   execute. Instead: reject with a short corrective message ("ref `e9` does not exist; valid
   refs: e1 e2 e3 e4") and re-prompt up to a small retry cap. This converts a class of
   hallucinated-ref failures into eventual successes and bounds blast radius.
4. **Secret write-gate stays.** `e2 (secret)` (password) must remain redacted and
   write-gated through the existing approval machinery regardless of targeting mode; the
   spike confirms the marker survives serialization, it does not relax the gate.

The post-run findings (success rates, the chosen rubric band, and which mitigations are
mandatory vs. optional) get written back to **ADR-0001 → "Spike findings (#67 …)"**.

---

## 7. Harness status — THROWAWAY, do not merge

The harness that runs §3 is **explicitly throwaway**:

- It lives only on a `spike/axtree-local-model` branch and is **never merged** to `master`.
- Its automated test (if any) is written as an **`#[ignore]` / `it.skip` stub** that does
  not run in CI — it requires a live local Ollama with the candidate models pulled, which CI
  does not have. It compiles/loads but is opt-in only (run by hand with the models present).
- It builds **no engine code** and adds **no crates**. It reuses
  `fetchOllamaChatStream`, `toolRegistry`, and `getOllamaToolDefinitions` as-is.

> **The harness exists to produce the §4 numbers and then be deleted.** The deliverable of
> this issue is this document plus the filled-in table and the recorded GO/NO-GO — not code.

---

## 8. Summary

- **Question:** is `ref=eNN` AX-tree targeting reliable enough on our **local** Ollama
  models to be the primary action mechanism, or must targeting be vision-driven?
- **Method:** fixed `data:` login-form fixture → hand-serialized short-ref outline →
  ~10 trials × 2 tasks per model through the real `fetchOllamaChatStream` +
  `getOllamaToolDefinitions` tool-calling path → record success / wrong-ref /
  hallucinated-ref / ignored-outline / wrong-tool + token counts; vision variant for
  vision-capable models.
- **Decision:** §5 rubric on the best shipped local model: ≥0.90 GO AX-primary; 0.70–0.89 GO
  with §6 mitigations; 0.50–0.69 pivot to vision-assist; <0.50 NO-GO for AX-primary.
- **Feeds #73:** short integer refs, pruned landmark lines, retry-on-bad-ref, retained secret
  write-gate.
- **Harness is throwaway / `#[ignore]`; no crates, no engine code.** Fill §4, pick the band,
  and record the outcome here and in ADR-0001.

---

## Status update — engine landed; harness ready

The CDP automation engine this spike gated is now **implemented** (#73,
`src-tauri/src/browser_engine.rs`) and a compiling, `#[ignore]`d harness lives in
`browser_engine.rs::spike_harness::axtree_snapshot_click_loop`. Run it on a machine with a
Chromium install:

```
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored axtree_snapshot_click_loop
```

Remaining (manual, on-machine): feed the produced `ref=eNN` outline to 2–3 representative local
Ollama models, record click-by-ref / type-by-ref success rates + token counts in the table above,
and write the go/no-go. The AX serializer itself is unit-tested (`src-tauri/src/ax.rs`).
