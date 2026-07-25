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
// NOTE: this project is on vitest 2.x, whose pool config lives under
// `poolOptions.forks.{maxForks,minForks}` (the flat top-level `maxWorkers` is a
// vitest 4 rename). Keep this in sync with the installed major version.
const cpuCount = os.cpus()?.length ?? 4;
const maxForks = Math.max(
  1,
  Number(process.env.VITEST_MAX_FORKS ?? Math.min(4, Math.floor(cpuCount / 2))),
);

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src-frontend/test/setup.ts',
    // Keep vitest on the src-frontend suites; the Playwright specs live in e2e/.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks,
        minForks: 1,
      },
    },
  },
});
