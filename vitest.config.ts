import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src-frontend/test/setup.ts'],
    globals: true,
    retry: 2,
    exclude: ['e2e/**', '**/node_modules/**'],
    // Live agent tests require gx10 server access
    // Run with: LIVE_QWEN=1 npx vitest run src-frontend/test/liveQwenAgent.test.ts
    environmentOptions: {
      // Add any needed options for live testing
    },
  },
});
