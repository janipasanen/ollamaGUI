import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openExternalUrl, isExternalUrl, _mocks } from '../services/openExternal';

// Stub the opener plugin so the fallback (window.open) path is exercised.
vi.mock('@tauri-apps/plugin-opener', () => ({}));

beforeEach(() => { _mocks.openUrl = null; });
afterEach(() => { _mocks.openUrl = null; });

describe('isExternalUrl (#354)', () => {
  it('matches http and https', () => {
    expect(isExternalUrl('https://example.com')).toBe(true);
    expect(isExternalUrl('http://foo.bar/baz')).toBe(true);
  });
  it('rejects non-http schemes and relative links', () => {
    expect(isExternalUrl('mailto:a@b.com')).toBe(false);
    expect(isExternalUrl('#anchor')).toBe(false);
    expect(isExternalUrl('/relative')).toBe(false);
    expect(isExternalUrl(undefined)).toBe(false);
  });
});

describe('openExternalUrl (#354)', () => {
  it('calls the test seam when set', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    _mocks.openUrl = fn;
    await openExternalUrl('https://example.com');
    expect(fn).toHaveBeenCalledWith('https://example.com');
  });
  it('falls back to window.open when the opener has no openUrl/open', async () => {
    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    await openExternalUrl('https://example.com');
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
    vi.unstubAllGlobals();
  });
});
