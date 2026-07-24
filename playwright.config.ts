import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config (#16b, #214).
 *
 * Drives the frontend-only Vite dev server (`npm run dev` → :5173). Tauri-only
 * features (filesystem, terminal, git, documents, native browser preview, OS
 * keychain) are unavailable in this mode, so the suites cover the web UI
 * surface: rendering, navigation, model picker, chat send (with the Ollama API
 * mocked via page.route), settings, and session history.
 *
 * Browsers are downloaded on demand on CI runners (Ubuntu/macOS-latest). On the
 * macOS-10.15 compatibility machine Playwright's chromium build is unavailable,
 * so run these suites on a supported host or in CI.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  // The frontend entry (App.tsx) is large; a cold dev-server compile or a first
  // navigation can legitimately exceed Playwright's 30 s default, so give tests
  // and navigations more headroom (also covers slower CI runners).
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
