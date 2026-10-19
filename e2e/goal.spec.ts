import { test, expect } from '@playwright/test';

/**
 * Goal mode (#668), end to end.
 *
 * The goal is stored like any other setting, so the two things worth proving in
 * a real browser are that it survives a reload and that the judge settings are
 * reachable and persist — the loop itself is covered by unit tests with a
 * mocked judge.
 */
// Two cold navigations against one dev server compile the whole app; running
// them serially keeps the compile out of the other test's time budget.
test.describe.configure({ mode: 'serial' });

test.describe('Goal mode', () => {
  test('a stored goal shows above the composer and can be cleared', async ({ page }) => {
    await page.route('**/api/tags', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [] }) }),
    );
    // Seed once per browser session: addInitScript runs on every navigation,
    // and re-seeding after the reload would undo the clear being tested.
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('goal-seeded')) {
        localStorage.setItem('ollama_gui_goal', 'make the failing test pass');
        sessionStorage.setItem('goal-seeded', '1');
      }
    });

    await page.goto('/');
    const banner = page.getByTestId('goal-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('make the failing test pass');

    await banner.getByRole('button', { name: 'Clear goal' }).click({ timeout: 30_000 });
    await expect(banner).toBeHidden();

    await page.reload();
    await expect(page.getByTestId('goal-banner')).toBeHidden();
  });

  test('the goal and judge model survive a settings round-trip', async ({ page }) => {
    await page.route('**/api/tags', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ models: [{ name: 'llama3:8b' }, { name: 'qwen2.5:1.5b' }] }),
      }),
    );

    await page.goto('/');
    // Cold-start compile of the app bundle can outlast the default action
    // timeout on a clean checkout; wait for the sidebar explicitly.
    const settingsBtn = page.getByRole('button', { name: '⚙️ Settings' });
    await expect(settingsBtn).toBeVisible({ timeout: 45_000 });
    await settingsBtn.click();

    const goalInput = page.getByTestId('goal-input');
    await goalInput.fill('green build on all three OSes');
    await goalInput.blur();

    // Judge checkpoints reveal the model picker; a small model is the point.
    await page.getByRole('switch', { name: 'Judge checkpoints' }).click();
    // The model list arrives from /api/models; wait for the option itself
    // rather than racing the fetch.
    const judgeSelect = page.getByTestId('judge-model');
    await expect(judgeSelect.locator('option[value="qwen2.5:1.5b"]')).toHaveCount(1, { timeout: 10_000 });
    await judgeSelect.selectOption('qwen2.5:1.5b');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('goal-banner')).toContainText('green build on all three OSes');

    await page.reload();
    await expect(page.getByTestId('goal-banner')).toContainText('green build on all three OSes');
    const stored = await page.evaluate(() => ({
      enabled: localStorage.getItem('ollama_gui_goal_judge_enabled'),
      model: localStorage.getItem('ollama_gui_goal_judge_model'),
    }));
    expect(stored).toEqual({ enabled: 'true', model: 'qwen2.5:1.5b' });
  });
});
