import { test, expect, type Page } from '@playwright/test';

/**
 * Persistence E2E (#664).
 *
 * The unit suites cover storage at the component level with stubbed
 * localStorage, so CI can go green while the real app boots empty — which is
 * exactly the #611 failure mode (loadInitialData awaited keychain calls before
 * reading storage, so the first paint said "No past conversations."). Only a
 * real browser plus a reload catches that class of regression.
 *
 * These tests drive the UI, reload, and assert the state survived.
 */

const SESSIONS_KEY = 'ollama_gui_sessions';
const FOLDERS_KEY = 'ollama_gui_folders';

/** Mock the Ollama endpoints the app touches on boot and on send. */
async function mockOllama(page: Page) {
  await page.route('**/api/models', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: [] }),
    })
  );
  await page.route('**/api/chat', (route) => {
    const body = [
      JSON.stringify({ message: { role: 'assistant', content: 'Acknowledged' }, done: false }),
      '\n',
      JSON.stringify({ done: true }),
    ].join('');
    return route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      headers: { 'transfer-encoding': 'chunked' },
      body,
    });
  });
}

/** Create a chat through the UI and wait until it exists in the sidebar. */
async function createChat(page: Page, text: string) {
  await page.getByRole('button', { name: 'Start new chat' }).click();
  await page.getByPlaceholder(/Message Ollama/i).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  const messages = page.getByTestId('messages-container');
  await expect(messages.getByText(text)).toBeVisible();
  await expect(messages.getByText('Acknowledged').first()).toBeVisible({ timeout: 15_000 });
}

test.describe('Persistence across reload (#664)', () => {
  test('a chat created in the UI is still in the sidebar after a reload', async ({ page }) => {
    await mockOllama(page);
    await page.goto('/');
    await createChat(page, 'Persist me');

    // #666: a single send must produce exactly one session, not two.
    const entries = page.getByRole('button', { name: /Load session:.*Persist me/i });
    await expect(entries).toHaveCount(1);

    await page.reload();
    // The sidebar is the only place the title appears after a reload (no
    // conversation is auto-opened), so seeing it proves storage was read before
    // the first paint.
    await expect(page.getByRole('button', { name: /Load session:.*Persist me/i })).toBeVisible();
    await expect(page.getByText(/No past conversations/i)).toBeHidden();
  });

  test('a deleted chat stays deleted after a reload', async ({ page }) => {
    await mockOllama(page);
    await page.goto('/');
    await createChat(page, 'Delete me');

    const entry = page.getByRole('button', { name: /Load session:.*Delete me/i });
    await expect(entry).toBeVisible();
    // Deletion goes through an in-app confirmation dialog (#338-era flow), not
    // window.confirm, so the delete button alone does nothing.
    await page.getByRole('button', { name: /Delete session:.*Delete me/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete chat confirmation' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('button', { name: /Load session:.*Delete me/i })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('button', { name: /Load session:.*Delete me/i })).toHaveCount(0);
    const stored = await page.evaluate((key) => localStorage.getItem(key), SESSIONS_KEY);
    expect(JSON.parse(stored ?? '[]')).toHaveLength(0);
  });

  test('a settings change (zoom) survives a reload', async ({ page }) => {
    await mockOllama(page);
    await page.goto('/');
    // Ctrl+= steps the root font scale by 0.1 (#342); it is stored under
    // ollama_gui_font_scale and applied to <html>. One step takes the 16px root
    // to 17.6px, which rounds to 18px.
    const rootFontSize = () => page.evaluate(() => document.documentElement.style.fontSize);
    await expect.poll(rootFontSize).toBe('16px');
    await page.keyboard.press('Control+=');
    await expect.poll(rootFontSize).toBe('18px');

    await page.reload();
    await expect.poll(rootFontSize).toBe('18px');
  });

  test('folder grouping is restored from storage on boot', async ({ page }) => {
    // Seeded rather than built through drag-and-drop: the point is that the
    // stored grouping renders after a reload, which is where #611 lived.
    await page.addInitScript(
      ([sessionsKey, foldersKey]) => {
        localStorage.setItem(
          foldersKey,
          JSON.stringify([{ id: 'f-work', name: 'Work', order: 0 }])
        );
        localStorage.setItem(
          sessionsKey,
          JSON.stringify([
            {
              id: 's-work',
              title: 'Grouped chat',
              messages: [],
              createdAt: Date.now(),
              model: 'llama3',
              folderId: 'f-work',
            },
          ])
        );
      },
      [SESSIONS_KEY, FOLDERS_KEY]
    );
    await mockOllama(page);
    await page.goto('/');

    // Folders surface as a per-session picker rather than a section header, so
    // the assertion is that the picker knows the folder and has the chat filed
    // under it.
    const folderPicker = page.locator('select').filter({ has: page.locator('option[value="f-work"]') });
    const expectGrouped = async () => {
      await expect(page.getByRole('button', { name: /Load session:.*Grouped chat/i })).toBeVisible();
      await expect(folderPicker).toHaveCount(1);
      await expect(folderPicker).toHaveValue('f-work');
    };
    await expectGrouped();

    await page.reload();
    await expectGrouped();
  });
});
