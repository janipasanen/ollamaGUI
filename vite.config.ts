import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import os from 'node:os';

// Root-cause fix for OOM/jetsam kills of the test run (#420):
//
// vitest defaults to the `forks` pool with one worker per CPU core. Every worker
// loads a full jsdom DOM implementation into its own Node heap, so on a 10-core
// machine the suite can spawn ~10 concurrent jsdom heaps and spike to several GB.
// On a loaded machine that spike exceeds available memory and the OS memory-
// pressure killer (jetsam on macOS) SIGKILLs the worker process group — which
// surfaced as "banner-only output then exit 1", never an actual test failure.
//
// We cap the pool so peak memory is bounded and predictable. Default to half the
// cores (max 4); override with VITEST_MAX_FORKS (e.g. =2 on a constrained laptop,
// or a higher value in CI). `isolate` stays on so each file's module registry is
// freed between files rather than accumulating.
//
// vitest 4 flattened `poolOptions.forks.{maxForks,minForks}` (the 2.x shape) into
// a single top-level `maxWorkers` (there is no minWorkers counterpart). Keep this
// in sync if the installed major version changes again.
const cpuCount = os.cpus()?.length ?? 4;
const maxWorkers = Math.max(
  1,
  Number(process.env.VITEST_MAX_FORKS ?? Math.min(4, Math.floor(cpuCount / 2))),
);

export default defineConfig({
  plugins: [react()],
  build: {
    // Pin the browser floor. Vite's default is the moving target
    // `baseline-widely-available`, so a Vite upgrade can raise the minimum
    // WebKit under us with no diff to review — and the failure mode is the
    // worst one available: a parse error in the boot chunk renders a blank
    // window, not an error.
    //
    // safari16.4 is the honest floor TODAY, and it is set by dependencies we
    // cannot transpile around, not by preference:
    //   - remark-gfm (mdast-util-gfm-autolink-literal) ships a RegExp
    //     lookbehind, which is an ECMAScript Early Error on older engines and
    //     cannot be down-levelled by any bundler.
    //   - Tailwind v4's output uses @property / oklch() / color-mix().
    // Safari 16.4 ships with macOS 13.3, which is what tauri.conf.json
    // declares as minimumSystemVersion. Keep the two in sync.
    target: ['safari16.4', 'chrome111', 'edge111', 'firefox114'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src-frontend/test/setup.ts',
    // Keep vitest on the src-frontend suites; the Playwright specs live in e2e/.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    pool: 'forks',
    maxWorkers,
    // CI retries live on the CI command line (build.yml passes --retry=2),
    // NOT here: an env-conditional `retry` in this config empirically wedges
    // local fork-worker startup on macOS (vitest 4.1.10) — workers time out
    // before running a single test.
  },
});
