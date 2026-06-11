/**
 * URL fetcher for web-browsing context injection (#122).
 *
 * Delegates to the Tauri `fetch_url` Rust command which downloads the page,
 * strips HTML, and returns clean text. Falls back to a stub in non-Tauri
 * environments (tests).
 */

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  fetchedAt: number;
}

export interface WebFetchOptions {
  /** Timeout in milliseconds (default 15 000). */
  timeoutMs?: number;
  /** Max characters of text to return (default 20 000). */
  maxChars?: number;
}

async function tauriInvoke(cmd: string, args: unknown): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args as Record<string, unknown>);
}

/** Test seam: set .fetchUrl on this object to override real Tauri invocations. */
export const _mocks = { fetchUrl: null as ((url: string) => Promise<FetchedPage>) | null };

export async function fetchUrl(url: string, opts: WebFetchOptions = {}): Promise<FetchedPage> {
  const { timeoutMs = 15_000, maxChars = 20_000 } = opts;

  if (_mocks.fetchUrl) return _mocks.fetchUrl(url);

  try {
    const result = await tauriInvoke('fetch_url', { url, timeoutMs, maxChars }) as FetchedPage;
    return result;
  } catch (e) {
    // Outside Tauri (dev server) — return a stub
    console.warn(`[webfetch] Tauri not available: ${e}`);
    return { url, title: url, text: '', fetchedAt: Date.now() };
  }
}
