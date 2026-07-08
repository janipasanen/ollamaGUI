import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src-frontend/test/setup.ts',
    // Keep vitest on the src-frontend suites; the Playwright specs live in e2e/.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
