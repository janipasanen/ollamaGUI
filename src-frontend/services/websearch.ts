/**
 * Web-search-augmented chat (#121).
 *
 * Supports DuckDuckGo (no key) and SearXNG (self-hosted).
 * Provider config persists in localStorage alongside other settings.
 * Results are fetched via the Tauri `web_search` Rust command.
 */

export type WebSearchProvider = 'duckduckgo' | 'searxng';

export interface WebSearchConfig {
  enabled: boolean;
  provider: WebSearchProvider;
  /** Base URL for self-hosted SearXNG instances. */
  searxngUrl?: string;
  /** Number of top results to fetch (default 5). */
  resultCount?: number;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const CONFIG_KEY = 'ollama_gui_websearch';

const DEFAULT_CONFIG: WebSearchConfig = {
  enabled: false,
  provider: 'duckduckgo',
  resultCount: 5,
};

export function loadWebSearchConfig(): WebSearchConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveWebSearchConfig(cfg: Partial<WebSearchConfig>): void {
  const current = loadWebSearchConfig();
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...current, ...cfg }));
}

// ── Test seam ─────────────────────────────────────────────────────────────────

/** Test seam: set .webSearch on this object to override real Tauri invocations. */
export const _mocks = { webSearch: null as ((query: string, cfg: WebSearchConfig) => Promise<WebSearchResult[]>) | null };

// ── Core search ───────────────────────────────────────────────────────────────

async function tauriInvoke(cmd: string, args: unknown): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args as Record<string, unknown>);
}

export async function webSearch(query: string, cfg?: WebSearchConfig): Promise<WebSearchResult[]> {
  const config = cfg ?? loadWebSearchConfig();
  if (!config.enabled) return [];

  if (_mocks.webSearch) return _mocks.webSearch(query, config);

  try {
    const results = await tauriInvoke('web_search', {
      query,
      provider: config.provider,
      count: config.resultCount ?? 5,
      searxngUrl: config.searxngUrl,
    }) as WebSearchResult[];
    return results;
  } catch (e) {
    console.warn(`[websearch] Tauri not available: ${e}`);
    return [];
  }
}

/** Format search results as a grounded context block for injection into the system prompt. */
export function formatResultsAsContext(results: WebSearchResult[]): string {
  if (results.length === 0) return '';
  const lines = results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`);
  return `Web search results:\n\n${lines.join('\n\n')}`;
}
