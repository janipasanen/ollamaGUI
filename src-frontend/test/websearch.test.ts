import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadWebSearchConfig, saveWebSearchConfig,
  webSearch, formatResultsAsContext, _mocks,
  type WebSearchConfig, type WebSearchResult,
} from '../services/websearch';

// Make the Tauri invoke seam controllable for error-path tests (#229).
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => {
  localStorage.clear();
  _mocks.webSearch = null;
});

afterEach(() => {
  _mocks.webSearch = null;
  localStorage.clear();
});

describe('WebSearch config persistence (#121)', () => {
  it('loads defaults when nothing is stored', () => {
    const cfg = loadWebSearchConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.provider).toBe('duckduckgo');
    expect(cfg.resultCount).toBe(5);
  });

  it('persists provider change', () => {
    saveWebSearchConfig({ provider: 'searxng', searxngUrl: 'http://localhost:8888' });
    const cfg = loadWebSearchConfig();
    expect(cfg.provider).toBe('searxng');
    expect(cfg.searxngUrl).toBe('http://localhost:8888');
  });

  it('persists enabled toggle', () => {
    saveWebSearchConfig({ enabled: true });
    expect(loadWebSearchConfig().enabled).toBe(true);
  });

  it('partial update preserves other fields', () => {
    saveWebSearchConfig({ provider: 'searxng' });
    saveWebSearchConfig({ enabled: true });
    const cfg = loadWebSearchConfig();
    expect(cfg.provider).toBe('searxng');
    expect(cfg.enabled).toBe(true);
  });
});

describe('webSearch with mock (#121)', () => {
  it('returns empty array when not enabled', async () => {
    _mocks.webSearch = async () => [{ title: 'T', url: 'u', snippet: 's' }];
    const cfg: WebSearchConfig = { enabled: false, provider: 'duckduckgo' };
    const results = await webSearch('test', cfg);
    expect(results).toEqual([]);
  });

  it('calls mock and returns results when enabled', async () => {
    const mockResults: WebSearchResult[] = [
      { title: 'Result 1', url: 'https://example.com/1', snippet: 'snippet one' },
      { title: 'Result 2', url: 'https://example.com/2', snippet: 'snippet two' },
    ];
    _mocks.webSearch = async () => mockResults;
    const cfg: WebSearchConfig = { enabled: true, provider: 'duckduckgo' };
    const results = await webSearch('latest news', cfg);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Result 1');
  });

  it('passes query and config to the mock', async () => {
    let capturedQuery = '';
    let capturedCfg: WebSearchConfig | null = null;
    _mocks.webSearch = async (q, c) => { capturedQuery = q; capturedCfg = c; return []; };
    const cfg: WebSearchConfig = { enabled: true, provider: 'searxng', searxngUrl: 'http://searx' };
    await webSearch('climate change', cfg);
    expect(capturedQuery).toBe('climate change');
    expect((capturedCfg as any)?.provider).toBe('searxng');
    expect((capturedCfg as any)?.searxngUrl).toBe('http://searx');
  });
});

describe('DuckDuckGo result parsing (#121)', () => {
  it('formats DuckDuckGo-style fixture results correctly', async () => {
    const fixture: WebSearchResult[] = [
      { title: 'OpenAI news', url: 'https://openai.com/blog', snippet: 'New model released.' },
    ];
    _mocks.webSearch = async () => fixture;
    const results = await webSearch('openai', { enabled: true, provider: 'duckduckgo' });
    expect(results[0].url).toContain('openai.com');
    expect(results[0].snippet).toBe('New model released.');
  });
});

describe('SearXNG result parsing (#121)', () => {
  it('formats SearXNG-style fixture results correctly', async () => {
    const fixture: WebSearchResult[] = [
      { title: 'SearX result', url: 'https://searx.example.com/r', snippet: 'A searxng match.' },
    ];
    _mocks.webSearch = async () => fixture;
    const results = await webSearch('q', { enabled: true, provider: 'searxng', searxngUrl: 'http://searx' });
    expect(results[0].snippet).toContain('searxng');
  });
});

describe('formatResultsAsContext (#121)', () => {
  it('wraps results in a numbered context block', () => {
    const results: WebSearchResult[] = [
      { title: 'Page A', url: 'https://a.com', snippet: 'About A.' },
      { title: 'Page B', url: 'https://b.com', snippet: 'About B.' },
    ];
    const block = formatResultsAsContext(results);
    expect(block).toContain('[1]');
    expect(block).toContain('[2]');
    expect(block).toContain('Page A');
    expect(block).toContain('https://b.com');
    expect(block).toContain('About A.');
  });

  it('returns empty string for no results', () => {
    expect(formatResultsAsContext([])).toBe('');
  });
});

describe('grounded request assembly (#121)', () => {
  it('search results become sources for injection', async () => {
    const fixture: WebSearchResult[] = [
      { title: 'News', url: 'https://news.com', snippet: 'Breaking news here.' },
    ];
    _mocks.webSearch = async () => fixture;
    const results = await webSearch('news', { enabled: true, provider: 'duckduckgo' });
    const block = formatResultsAsContext(results);
    expect(block).toContain('Web search results');
    expect(block).toContain('News');
    expect(block).toContain('https://news.com');
  });
});

// ── Error paths (#229) ────────────────────────────────────────────────────────

describe('webSearch error handling (#229)', () => {
  beforeEach(() => {
    _mocks.webSearch = null;
    invokeMock.mockReset();
  });

  it('returns [] when the Tauri web_search invoke rejects (graceful fallback)', async () => {
    invokeMock.mockRejectedValueOnce(new Error('network down'));
    const cfg: WebSearchConfig = { enabled: true, provider: 'duckduckgo' };
    const results = await webSearch('anything', cfg);
    expect(results).toEqual([]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe('web_search');
  });

  it('does not throw when invoke rejects', async () => {
    invokeMock.mockRejectedValueOnce(new Error('boom'));
    const cfg: WebSearchConfig = { enabled: true, provider: 'searxng', searxngUrl: 'http://x' };
    await expect(webSearch('q', cfg)).resolves.toEqual([]);
  });

  it('passes provider/count/searxngUrl to the invoke args', async () => {
    invokeMock.mockResolvedValueOnce([]);
    const cfg: WebSearchConfig = { enabled: true, provider: 'searxng', searxngUrl: 'http://searx:8080', resultCount: 8 };
    await webSearch('hello', cfg);
    const args = invokeMock.mock.calls[0][1] as Record<string, unknown>;
    expect(args).toMatchObject({ query: 'hello', provider: 'searxng', count: 8, searxngUrl: 'http://searx:8080' });
  });
});

describe('loadWebSearchConfig corrupt JSON (#229)', () => {
  it('returns defaults when localStorage holds invalid JSON', () => {
    localStorage.setItem('ollama_gui_websearch', '{not valid json');
    const cfg = loadWebSearchConfig();
    expect(cfg).toEqual({ enabled: false, provider: 'duckduckgo', resultCount: 5 });
  });
});
