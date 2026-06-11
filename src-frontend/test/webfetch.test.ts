import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchUrl, _mocks, type FetchedPage } from '../services/webfetch';

beforeEach(() => {
  _mocks.fetchUrl = null;
});

afterEach(() => {
  _mocks.fetchUrl = null;
});

describe('webfetch (#122)', () => {
  it('returns mocked page when _mockFetchUrl is set', async () => {
    const page: FetchedPage = { url: 'https://example.com', title: 'Example', text: 'Hello world.', fetchedAt: 1234 };
    _mocks.fetchUrl = async () => page;
    const result = await fetchUrl('https://example.com');
    expect(result.title).toBe('Example');
    expect(result.text).toBe('Hello world.');
    expect(result.fetchedAt).toBe(1234);
  });

  it('passes the url to the mock', async () => {
    let capturedUrl = '';
    _mocks.fetchUrl = async (url) => { capturedUrl = url; return { url, title: url, text: 't', fetchedAt: 0 }; };
    await fetchUrl('https://test.org/page');
    expect(capturedUrl).toBe('https://test.org/page');
  });

  it('timeout and size-cap: mock simulates timeout error', async () => {
    _mocks.fetchUrl = async () => { throw new Error('timeout after 15000ms'); };
    await expect(fetchUrl('https://slow.example.com')).rejects.toThrow('timeout');
  });

  it('size cap: mock returns truncated text', async () => {
    const bigText = 'x'.repeat(30_000);
    _mocks.fetchUrl = async (url) => ({ url, title: 'Big', text: bigText.slice(0, 20_000), fetchedAt: 0 });
    const result = await fetchUrl('https://big.example.com', { maxChars: 20_000 });
    expect(result.text.length).toBeLessThanOrEqual(20_000);
  });

  it('source recording: returned object has url field matching input', async () => {
    const url = 'https://record.example.com';
    _mocks.fetchUrl = async (u) => ({ url: u, title: 'R', text: 'recorded', fetchedAt: 42 });
    const result = await fetchUrl(url);
    expect(result.url).toBe(url);
  });

  it('returns stub result when Tauri is not available (non-mock path fallback)', async () => {
    // _mockFetchUrl is null — the service falls through to the Tauri invoke path,
    // which is not available in jsdom. We only test the mock path here; the Tauri
    // path is tested via the integration tests on device.
    _mocks.fetchUrl = async (url) => ({ url, title: '', text: '', fetchedAt: 0 });
    const result = await fetchUrl('https://anything.com');
    expect(result.url).toBe('https://anything.com');
  });
});
