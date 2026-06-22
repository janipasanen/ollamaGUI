/**
 * Browser preview panel (#172).
 *
 * Wraps the Rust `preview_webview_*` commands, which embed a native child
 * webview inside the Tauri window so the user can see a live page alongside
 * the chat UI. The TypeScript side tracks open/closed state and provides typed
 * helpers that match the Rust command signatures.
 */

import { invoke } from '@tauri-apps/api/core';

export interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

let _open = false;

export function isPreviewOpen(): boolean {
  return _open;
}

/**
 * Open (or replace) the native preview webview at the given URL.
 * `rect` describes the position and size relative to the main window.
 * `allow` is an optional list of URL prefixes/patterns the preview may navigate to.
 */
export async function openPreview(url: string, rect: PreviewRect, allow?: string[]): Promise<void> {
  await invoke('preview_webview_open', { url, rect, allow: allow ?? [] });
  _open = true;
}

/**
 * Navigate the already-open preview to a new URL (subject to the original allow-list).
 * No-ops if the preview is not open.
 */
export async function navigatePreview(url: string, allow?: string[]): Promise<void> {
  if (!_open) return;
  await invoke('preview_webview_navigate', { url, allow: allow ?? [] });
}

/**
 * Reposition/resize the preview to match a new layout rectangle.
 * Call this from a ResizeObserver or on window resize.
 */
export async function setBoundsPreview(rect: PreviewRect): Promise<void> {
  if (!_open) return;
  await invoke('preview_webview_set_bounds', { rect });
}

/** Reload the current preview page. */
export async function reloadPreview(): Promise<void> {
  if (!_open) return;
  await invoke('preview_webview_reload');
}

/** Close the native preview webview. */
export async function closePreview(): Promise<void> {
  if (!_open) return;
  try {
    await invoke('preview_webview_close');
  } finally {
    _open = false;
  }
}
