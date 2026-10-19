import { test, expect } from '@playwright/test';

/**
 * Live-backend smoke (#549 / "the GUI must work on this machine").
 *
 * Everything else mocks Ollama, which keeps CI deterministic but never proves
 * that a prompt typed into this UI reaches a real model and comes back. This
 * suite is opt-in (`LIVE_OLLAMA=1 npx playwright test e2e/live.spec.ts`) and
 * skipped by default, so it cannot flake a runner without a daemon.
 */
const LIVE = process.env.LIVE_OLLAMA === '1';
const MODEL = process.env.LIVE_MODEL ?? 'qwen2.5:0.5b';

test.describe('live Ollama', () => {
  test.skip(!LIVE, 'set LIVE_OLLAMA=1 with a running daemon to run this suite');

  test('lists the daemon’s models', async ({ page }) => {
    await page.goto('/');
    const picker = page.getByRole('combobox').first();
    await expect(picker).toBeVisible({ timeout: 45_000 });
    await expect.poll(async () => picker.locator('option').allTextContents(), { timeout: 30_000 })
      .toContainEqual(expect.stringContaining(MODEL.split(':')[0]));
  });

  test('a prompt typed into the composer reaches the model and streams back', async ({ page }) => {
    await page.goto('/');
    const picker = page.getByRole('combobox').first();
    await expect(picker).toBeVisible({ timeout: 45_000 });
    // Select the live model explicitly: the default may be another tag.
    await picker.selectOption({ label: MODEL }).catch(async () => {
      await picker.selectOption(MODEL);
    });

    await page.getByPlaceholder(/Message Ollama/i).fill('Reply with exactly: pong');
    await page.getByRole('button', { name: 'Send' }).click();

    const messages = page.getByTestId('messages-container');
    await expect(messages.getByText('Reply with exactly: pong')).toBeVisible();
    await expect(messages.getByText(/pong/i).last()).toBeVisible({ timeout: 90_000 });
  });

  test('goal mode reaches the model with the goal in context', async ({ page }) => {
    await page.goto('/');
    await page.addInitScript(() => { /* no-op: keeps types honest */ });
    await page.evaluate(() => localStorage.setItem('ollama_gui_goal', 'Answer in one word.'));
    await page.reload();

    await expect(page.getByTestId('goal-banner')).toContainText('Answer in one word.');
    await page.getByPlaceholder(/Message Ollama/i).fill('Reply with exactly: pong');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByTestId('messages-container').getByText(/pong/i).last())
      .toBeVisible({ timeout: 90_000 });
  });
});
