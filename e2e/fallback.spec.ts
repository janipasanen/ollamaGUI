import { test, expect } from '@playwright/test';

/**
 * Model fallback settings (#669): the chain is visible and editable in the
 * Settings window and survives a reload. The loop behaviour is covered by
 * unit tests; this proves the window itself.
 */
test.describe.configure({ mode: 'serial' });

test.describe('fallback models', () => {
  test('shows the configured chain and persists changes', async ({ page }) => {
    await page.route('**/api/tags', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ models: [{ name: 'llama3:8b' }, { name: 'qwen2.5:1.5b' }, { name: 'phi4:mini' }] }),
      }),
    );
    // Seed once: addInitScript runs on every navigation and would otherwise
    // overwrite the value the test just saved before the reload check.
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('fallback-seeded')) {
        localStorage.setItem('ollama_gui_fallback_models', JSON.stringify(['qwen2.5:1.5b']));
        sessionStorage.setItem('fallback-seeded', '1');
      }
    });

    await page.goto('/');
    const settingsBtn = page.getByRole('button', { name: '⚙️ Settings' });
    await expect(settingsBtn).toBeVisible({ timeout: 45_000 });
    await settingsBtn.click();

    const select = page.getByTestId('fallback-models');
    await expect(select).toBeVisible();
    await expect(select.locator('option[value="qwen2.5:1.5b"]')).toHaveCount(1, { timeout: 10_000 });
    // A controlled <select> sets the `selected` property, not the attribute.
    await expect(select.locator('option[value="qwen2.5:1.5b"]')).toHaveJSProperty('selected', true);

    await select.selectOption(['phi4:mini']);
    await expect.poll(async () => page.evaluate(() => localStorage.getItem('ollama_gui_fallback_models')))
      .toBe(JSON.stringify(['phi4:mini']));

    await page.reload();
    // The overlay is not restored on reload; open it again.
    const reopened = page.getByRole('button', { name: '⚙️ Settings' });
    await expect(reopened).toBeVisible({ timeout: 45_000 });
    await reopened.click();
    await expect(page.getByTestId('fallback-models')).toBeVisible();
    // Read the live selection rather than an attribute: React drives the
    // property, and the option list arrives after the overlay mounts.
    await expect.poll(async () =>
      page.getByTestId('fallback-models').evaluate((el: HTMLSelectElement) =>
        Array.from(el.selectedOptions).map(o => o.value)),
      { timeout: 30_000 },
    ).toEqual(['phi4:mini']);
  });
});
