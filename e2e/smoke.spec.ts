import { test, expect } from '@playwright/test';

/**
 * Smoke E2E (#214). Renders the app, opens settings, and sends a chat message
 * with the Ollama `/api/chat` stream mocked so no real backend is required.
 */
test.describe('App smoke', () => {
  test('renders the chat UI and header', async ({ page }) => {
    await page.goto('/');
    // Minimal Ollama-style UI (#549): no app-title heading and no header
    // buttons — the sidebar "+ New" button and the composer are the anchors.
    await expect(page.getByRole('button', { name: 'Start new chat' })).toBeVisible();
    await expect(page.getByPlaceholder(/Message Ollama/i)).toBeVisible();
  });

  test('opens and closes the settings overlay', async ({ page }) => {
    await page.goto('/');
    // Settings moved from the header to the sidebar footer (#549).
    await page.getByRole('button', { name: '⚙️ Settings' }).click();
    await expect(page.getByRole('heading', { name: /^Settings$/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /^Settings$/i })).toBeHidden();
  });

  test('sends a message and renders the streamed reply', async ({ page }) => {
    // Mock the models endpoint so the picker initializes cleanly.
    await page.route('**/api/models', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [] }) }),
    );
    // Mock the chat stream as a single NDJSON chunk then a `done` frame.
    await page.route('**/api/chat', (route) => {
      const body = [
        JSON.stringify({ message: { role: 'assistant', content: 'Hello' }, done: false }),
        '\n',
        JSON.stringify({ done: true }),
      ].join('');
      route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        headers: { 'transfer-encoding': 'chunked' },
        body,
      });
    });

    await page.goto('/');
    await page.getByPlaceholder(/Message Ollama/i).fill('Hi there');
    await page.getByRole('button', { name: 'Send' }).click();

    // The user message and the mocked assistant reply should appear.
    const messages = page.getByTestId('messages-container');
    await expect(messages.getByText('Hi there')).toBeVisible();
    await expect(messages.getByText('Hello').first()).toBeVisible({ timeout: 10_000 });
  });
});
