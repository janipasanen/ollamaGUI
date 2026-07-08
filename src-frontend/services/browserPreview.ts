/**
 * Browser preview panel (#172).
 *
 * Wraps the Rust `preview_webview_*` commands, which embed a native child
 * webview inside the Tauri window so the user can see a live page alongside
 * the chat UI. The TypeScript side tracks open/closed state and provides typed
 * helpers that match the Rust command signatures.
 *
 * `components/BrowserPane.tsx` delegates its native-preview IPC here so the
 * command surface + open/close bookkeeping lives in one place. A mutable
 * `_mocks.invoke` seam (matching the repo convention) lets tests stand in a
 * fake without importing the real Tauri runtime.
 */

export interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

export const _mocks = {
  invoke: null as ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null,
};

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (_mocks.invoke) return _mocks.invoke(cmd, args) as Promise<T>;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _open = false;

export function isPreviewOpen(): boolean {
  return _open;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open (or replace) the native preview webview at the given URL.
 * `rect` describes the position and size relative to the main window.
 * `allow` is an optional list of URL prefixes/patterns the preview may navigate to.
 *
 * `_open` is set optimistically (before awaiting the IPC) so a fire-and-forget
 * caller (BrowserPane's `openNativePreview`) can immediately issue follow-up
 * `setBoundsPreview`/`reloadPreview` calls without waiting on the await.
 */
export async function openPreview(url: string, rect: PreviewRect, allow?: string[]): Promise<void> {
  _open = true;
  await tauriInvoke<void>('preview_webview_open', { url, rect, allow: allow ?? [] });
}

/**
 * Navigate the already-open preview to a new URL (subject to the original allow-list).
 * No-ops if the preview is not open.
 */
export async function navigatePreview(url: string, allow?: string[]): Promise<void> {
  if (!_open) return;
  await tauriInvoke<void>('preview_webview_navigate', { url, allow: allow ?? [] });
}

/**
 * Reposition/resize the preview to match a new layout rectangle.
 * Call this from a ResizeObserver or on window resize.
 */
export async function setBoundsPreview(rect: PreviewRect): Promise<void> {
  if (!_open) return;
  await tauriInvoke<void>('preview_webview_set_bounds', { rect });
}

/** Reload the current preview page. */
export async function reloadPreview(): Promise<void> {
  if (!_open) return;
  await tauriInvoke<void>('preview_webview_reload', {});
}

/** Close the native preview webview. */
export async function closePreview(): Promise<void> {
  if (!_open) return;
  _open = false;
  try {
    await tauriInvoke<void>('preview_webview_close', {});
  } catch {
    /* already torn down / no Tauri — ignore */
  }
}

/** Test-only: reset the internal open flag between tests. */
export function _resetPreviewState(): void {
  _open = false;
}
