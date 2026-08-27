/**
 * Open an external URL in the user's system browser (#354).
 *
 * Markdown links inside messages must not navigate the Tauri webview — they
 * should hand off to the OS browser, exactly like citation sources do
 * (`services/citations.ts`). This centralises that hand-off with a test seam.
 */

export const _mocks = {
  openUrl: null as ((url: string) => Promise<void> | void) | null,
};

/** True for absolute http(s) URLs that should be opened externally. */
export function isExternalUrl(href: string | undefined): boolean {
  return /^https?:\/\//i.test(href ?? '');
}

/** Open `url` in the system browser, falling back to window.open. */
export async function openExternalUrl(url: string): Promise<void> {
  if (_mocks.openUrl) {
    await _mocks.openUrl(url);
    return;
  }
  // Tauri v1 has no shell.openExternal; window.open (guarded by allowlisted
  // schemes upstream) opens the external browser without leaving the webview.
  window.open(url, '_blank', 'noopener');
}
