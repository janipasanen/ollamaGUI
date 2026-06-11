# Spike 0001 — Release-Binary Size Budget for Document I/O

- **Issue:** #138 — SPIKE: measure release-binary delta of document crates + Pandoc sidecar; produce a go/no-go budget decision.
- **Status:** Decision recorded; measurement cells to be filled on a throwaway branch.
- **Target platform for sizing:** `aarch64-apple-darwin` (primary release target). Re-run on
  `x86_64-pc-windows-msvc` and `x86_64-unknown-linux-gnu` before shipping those builds.
- **Decision owner:** document-I/O track.

This spike is **decision-oriented**: it fixes the size budget, the measurement method, and the
go/no-go rules *before* heavy document crates land. No crates are added by this spike. The actual
numbers are produced on a throwaway branch and pasted into the empty cells below.

---

## 1. Baseline crate set (today)

The current `src-tauri/Cargo.toml` `[dependencies]` block — this is the baseline we measure deltas
against:

| Crate | Role |
| --- | --- |
| `tauri` (v2) | App framework / runtime |
| `tauri-plugin-opener` | Open files/URLs in the OS |
| `tauri-plugin-dialog` | Native file dialogs |
| `serde` (derive) | (De)serialization |
| `serde_json` | JSON |
| `lazy_static` | Process-wide statics (MLX server, workspace root) |
| `reqwest` (json, stream) | HTTP to Ollama / downloads |
| `tokio` (full) | Async runtime |
| `keyring` | OS secret store |
| `aes-gcm` | Encrypted-file secret fallback |
| `sysinfo` | System-memory model-fit indicator |
| `zip` (v2) | **Already merged** — read side of docx/xlsx/pptx/odt (ZIP containers) |
| `quick-xml` (v0.36) | **Already merged** — XML parsing inside those containers |

**Key fact:** `zip` and `quick-xml` are *already in the baseline* (merged for the document **read**
path, #139). They are **not** a new delta in any row below — every office/PDF measurement is taken on
top of a tree that already contains them. Do not double-count them.

The crates under evaluation in this spike are the **write/convert** additions and the **Pandoc**
sidecar, which are heavier and are the reason this budget exists.

---

## 2. Measurement methodology

Run on a **throwaway branch** (`spike/doc-binary-size`). Do **not** merge it; it exists only to
produce numbers. One crate-group is added per row, **cumulatively re-baselined** (i.e. each row's
delta is measured against the *baseline*, by adding only that group on top of baseline, then
reverting). Build each variant clean and record both the raw binary and the bundled artifact.

Reproducible build/measure recipe (per variant):

```sh
# 1. Clean to avoid incremental-artifact skew.
cargo clean --manifest-path src-tauri/Cargo.toml

# 2. Release build for the primary target.
cargo build --release --manifest-path src-tauri/Cargo.toml \
  --target aarch64-apple-darwin

# 3a. Raw stripped binary size (what actually ships inside the .app).
#     Tauri v2 strips release binaries by default; confirm and measure the real file.
stat -f%z src-tauri/target/aarch64-apple-darwin/release/src-tauri-tmp

# 3b. Full bundle size (the .app / .dmg the user downloads).
npm run tauri build -- --target aarch64-apple-darwin
du -sk src-tauri/target/aarch64-apple-darwin/release/bundle/macos/*.app
du -sk src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg
```

Notes that keep the numbers honest:

- Always `cargo clean` between variants — incremental artifacts inflate/deflate sizes
  unpredictably.
- Measure the **stripped** release binary (Tauri strips by default). If we ever disable stripping,
  re-measure; symbols can add several MB.
- Record the binary delta (col. "Binary Δ") as the headline metric for the budget; the bundle/DMG
  columns are informational (compression and framework bundling change them).
- `infer` is grouped with office writers because it is the content-type sniffer used to route
  document writes; it is tiny but listed so its cost is visible, not assumed-zero.

### Measurement table — fill after building

Binary sizes in MB; deltas relative to **Baseline** row. Leave the Pandoc binary delta blank because
Pandoc is a **sidecar**, not a linked crate — its cost is the downloaded executable, measured
separately in the Pandoc row.

| Variant | New crates added (on top of baseline) | Release binary (MB) | Binary Δ vs baseline (MB) | .app bundle (MB) | .dmg (MB) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **Baseline** | *(none — includes `zip` + `quick-xml`)* |  | 0.00 |  |  | reference |
| **+ Office** | `calamine`, `rust_xlsxwriter`, `umya-spreadsheet`, `infer` |  |  |  |  | xlsx/ods read+write |
| **+ PDF** | `pdf-extract`, `printpdf`, `lopdf` |  |  |  |  | pdf read + generate |
| **+ Office + PDF** | all of the above together |  |  |  |  | combined real-world delta |
| **+ Pandoc sidecar** | *(no crate — bundled binary)* | n/a | n/a (see below) |  |  | Pandoc exe size for `aarch64-apple-darwin`, measured standalone |

### Pandoc sidecar — measure separately

Pandoc is **not** a Rust crate; it is a standalone executable. Its cost is the binary we would ship
or download, not a link-time delta. Measure it on its own:

| Pandoc artifact (`aarch64-apple-darwin`) | Size (MB) | Source |
| --- | --- | --- |
| Pandoc release binary (compressed download) |  | pandoc.org release tarball, arm64 |
| Pandoc release binary (uncompressed on disk) |  | after extraction |

If bundled, it lands under Tauri's `externalBin` (sidecar) and adds its uncompressed size to the
`.app`. If downloaded on demand (see §3), it adds **zero** to the shipped bundle.

---

## 3. Budget decision

These limits are **decided now**, before crates land:

1. **Linked-crate binary delta budget: ≤ 25 MB** for the **combined** office + PDF additions
   (the "+ Office + PDF" row), measured as the stripped release-binary delta vs baseline on
   `aarch64-apple-darwin`. `zip`/`quick-xml` are baseline and excluded from this delta.
2. **Pandoc is accounted separately** and is **NOT** counted against the 25 MB crate budget.
   - If bundling Pandoc keeps the total download within an acceptable range, it may ship as a
     Tauri sidecar (`externalBin`).
   - If Pandoc's size **exceeds budget** (it is a large Haskell binary, typically tens of MB), it
     becomes an **OPTIONAL, on-demand download**: the app ships without it and fetches it (or
     detects a user-installed `pandoc` on `PATH`) only when a conversion that needs it is invoked.
3. **NEVER bundle LibreOffice.** LibreOffice is hundreds of MB and is out of the question as a
   bundled dependency. It is **detect-only / optional**: if a `soffice`/LibreOffice install is found
   on the system, advanced conversions may route through it; otherwise that path is simply
   unavailable and we degrade gracefully. We never ship it and never download it automatically.

### Why these numbers

- 25 MB is roughly the most we can add to a Tauri app's binary before the download stops feeling
  "lightweight" relative to the current baseline. It is generous enough for the pure-Rust office +
  PDF crates if they behave, and tight enough to force a decision if one of them is bloated.
- Pandoc and LibreOffice are external-tool concerns, not link-time concerns, so they are governed by
  the "optional engine" rule (§4) rather than the crate budget.

---

## 4. Go / no-go rubric

After filling the table, apply this rubric to the **combined "+ Office + PDF"** binary delta:

| Combined binary Δ | Decision |
| --- | --- |
| ≤ 25 MB | **GO** — land all evaluated crates as direct dependencies. |
| > 25 MB | **CONDITIONAL** — apply the drop/move rule below until the delta is ≤ 25 MB, then GO. |
| Cannot get ≤ 25 MB even after the drop/move rule | **NO-GO for bundling** — the heavy format moves entirely behind an optional external engine (Pandoc on-demand / detected LibreOffice). |

**Per-crate drop/move rule (the load-bearing rule):**

> Any individual crate whose marginal binary delta pushes the combined total over 25 MB is either
> (a) **dropped** (the format it serves is handled by an existing lighter crate or by the optional
> engine), or (b) **moved behind the optional engine** — its functionality is provided on demand via
> Pandoc / detected LibreOffice rather than linked into every build.

To attribute marginal cost per crate when the combined row is over budget, measure each office/PDF
crate **individually** on top of baseline (extra throwaway builds), then drop/move the worst
offenders first until the combined delta fits.

### Optional-engine model: mirror `check_mlx_available`

Optional engines (on-demand Pandoc, detected LibreOffice) must follow the **exact pattern already
used for MLX** in `src-tauri/src/lib.rs`:

- `check_mlx_available` (lib.rs ~L700) is a `#[tauri::command] async fn` that returns a small
  serializable availability struct (`available`, plus the specific reasons: `apple_silicon`,
  `mlx_lm`, resolved `python` path, `version`, and a human-readable `reason`). It probes the
  environment via a helper (`detect_mlx_python`, ~L679) that shells out and checks success, wrapped
  in `spawn_blocking` so the probe never blocks the async runtime. When the runtime is absent it
  returns `available: false` with an actionable `reason` (e.g. the install command) — it never
  errors the app.

- The document optional engines should expose the same shape, e.g. `check_pandoc_available` /
  `check_libreoffice_available`: detect a binary on `PATH` (and our managed download location for
  Pandoc), return `{ available, path, version, reason }`, probe via `spawn_blocking`, and degrade
  gracefully with a "not installed / download available" reason. The frontend gates the
  conversion UI on `available`, exactly as the MLX UI gates on `check_mlx_available`.

This keeps "optional heavy engine" behavior consistent across MLX, Pandoc, and LibreOffice and
ensures a missing engine is a graceful capability gap, never a crash.

---

## 5. Follow-up: CI size guard

Add a follow-up CI check (separate issue) that **fails the build if the release binary grows beyond
budget**, so the 25 MB decision is enforced automatically and we never silently regress:

- After the release build, measure the stripped binary for `aarch64-apple-darwin`.
- Compare against a committed baseline size (recorded once the document crates land) plus the
  agreed headroom.
- **Fail the job** if the binary exceeds `baseline + 25 MB` (the crate budget) — Pandoc/LibreOffice
  are excluded because they are not linked in.
- Print the actual size and the delta in the failure message so the regressing PR is obvious.

Sketch (to live in the CI workflow, not added here):

```sh
SIZE=$(stat -f%z src-tauri/target/aarch64-apple-darwin/release/src-tauri-tmp)
LIMIT=$((BASELINE_BYTES + 25*1024*1024))
if [ "$SIZE" -gt "$LIMIT" ]; then
  echo "::error::Release binary $SIZE B exceeds budget $LIMIT B (+25MB over baseline)"
  exit 1
fi
```

---

## 6. Summary

- **Baseline already includes `zip` + `quick-xml`** (read path); all deltas are measured on top of
  that and exclude them.
- **Budget: ≤ 25 MB** combined binary delta for office + PDF crates, measured stripped on
  `aarch64-apple-darwin`.
- **Pandoc** is accounted separately and becomes an **optional on-demand download** if it exceeds
  budget. **LibreOffice is never bundled** — detect-only/optional.
- **Over-budget crates are dropped or moved behind the optional engine**, which is modeled on
  `check_mlx_available`'s graceful optional-runtime detection.
- **CI guard** to be added so the binary can't silently grow past budget.

Fill the empty cells on the throwaway branch, apply the §4 rubric, and record the final GO /
CONDITIONAL / NO-GO outcome at the top of this file.
