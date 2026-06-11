/**
 * Chromium acquisition client (#68).
 *
 * Browser-automation features need a Chromium-class engine. The Rust side
 * (`browser_chromium.rs`) prefers a system install (Chrome / Chromium / Edge /
 * Brave) and only falls back to a consented download when nothing is found.
 *
 * This module is the thin frontend over those two commands:
 *   - `getChromiumStatus()` -> `browser_chromium_status`
 *   - `downloadChromium()`  -> `browser_chromium_download`
 * plus `needsChromiumPrompt()`, the small derived rule the UI uses to decide
 * whether to show the "download Chromium?" consent prompt.
 *
 * Following the repo's service convention, a mutable `_mocks.invoke` seam lets
 * tests stand in a fake without importing the real Tauri runtime.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Where a located Chromium engine came from. */
export type ChromiumSource = 'system' | 'downloaded' | 'none';

/** Result of probing for an available Chromium engine. */
export interface ChromiumStatus {
  /** True when a usable engine was located (system or previously downloaded). */
  found: boolean;
  /** Origin of the engine: 'system', 'downloaded', or 'none'. */
  source: ChromiumSource;
  /** Absolute path to the engine binary, if found. */
  path?: string;
  /** Version string parsed from `--version`, if it could be determined. */
  version?: string;
}

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

export const _mocks = {
  invoke: null as ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null,
};

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (_mocks.invoke) return _mocks.invoke(cmd, args) as Promise<T>;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probe for an available Chromium engine. Resolves to a {@link ChromiumStatus}
 * describing whether one was found and where it came from. Never rejects in the
 * common case — a missing engine surfaces as `{ found: false, source: 'none' }`.
 */
export async function getChromiumStatus(): Promise<ChromiumStatus> {
  return tauriInvoke<ChromiumStatus>('browser_chromium_status');
}

/**
 * Download a Chromium build for the host platform after the user consents.
 * Resolves to the absolute path of the installed binary.
 *
 * NOTE: the Rust body is currently DEFERRED and rejects with
 * "Chromium download not yet implemented — locate a system install"; callers
 * should surface that message and steer the user toward a system install.
 */
export async function downloadChromium(): Promise<string> {
  return tauriInvoke<string>('browser_chromium_download');
}

/**
 * Whether the UI should prompt the user to download Chromium.
 *
 * We only nudge when no engine exists at all (`source === 'none'`). A system or
 * previously downloaded engine means we stay quiet.
 */
export function needsChromiumPrompt(status: ChromiumStatus): boolean {
  return status.source === 'none';
}
