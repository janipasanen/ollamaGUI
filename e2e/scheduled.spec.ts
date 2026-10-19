import { test, expect } from '@playwright/test';

/**
 * Scheduled runs (#671): entries are editable in Settings, survive a reload, and
 * a due entry actually starts a run through the normal agent path.
 */
test.describe.configure({ mode: 'serial' });

const settings = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: '⚙️ Settings' });

test('adds, pauses and deletes a scheduled run, and keeps it across a reload', async ({ page }) => {
  await page.route('**/api/tags', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [] }) }));

  await page.goto('/');
  await expect(settings(page)).toBeVisible({ timeout: 45_000 });
  await settings(page).click();

  await page.getByTestId('schedule-goal').fill('keep the build green');
  await page.getByTestId('schedule-interval').fill('90');
  await page.getByTestId('schedule-add').click();

  const entry = page.getByTestId('schedule-entry');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('keep the build green');
  await expect(entry).toContainText('every 90 min');

  // Pause it, then reload: both the entry and its disabled state must survive.
  await page.getByTestId('schedule-toggle').click();
  await expect(page.getByTestId('schedule-toggle')).toHaveAttribute('aria-checked', 'false');

  await page.reload();
  await expect(settings(page)).toBeVisible({ timeout: 45_000 });
  await settings(page).click();
  await expect(page.getByTestId('schedule-entry')).toContainText('keep the build green');
  await expect(page.getByTestId('schedule-toggle')).toHaveAttribute('aria-checked', 'false');

  await page.getByTestId('schedule-delete').click();
  await expect(page.getByTestId('schedule-empty')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('ollama_gui_schedules')))
    .toBe('[]');
});

test('a due entry starts a real run in its own session', async ({ page }) => {
  test.setTimeout(180_000);
  await page.route('**/api/tags', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [] }) }));
  await page.route('**/api/chat', route => {
    const body = [
      JSON.stringify({ message: { role: 'assistant', content: 'Scheduled run reporting in.' }, done: false }),
      '\n',
      JSON.stringify({ done: true }),
    ].join('');
    route.fulfill({
      status: 200, contentType: 'application/x-ndjson',
      headers: { 'transfer-encoding': 'chunked' }, body,
    });
  });
  // Seed one entry that is already due: created two minutes ago, every minute.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('schedule-seeded')) return;
    sessionStorage.setItem('schedule-seeded', '1');
    localStorage.setItem('ollama_gui_schedules', JSON.stringify([{
      id: 'due-now', goal: 'check the deploy', model: '', kind: 'interval',
      intervalMinutes: 1, enabled: true, createdAt: Date.now() - 300_000,
    }]));
  });

  await page.goto('/');
  await expect(settings(page)).toBeVisible({ timeout: 45_000 });

  // The run opens its own session, titled with the goal.
  await expect(page.getByText(/⏱ check the deploy/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Scheduled run reporting in.')).toBeVisible({ timeout: 30_000 });

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ollama_gui_schedules') ?? '[]'));
  expect(stored[0].lastRunAt).toBeGreaterThan(0);
});
