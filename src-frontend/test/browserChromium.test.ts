import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getChromiumStatus,
  downloadChromium,
  needsChromiumPrompt,
  type ChromiumStatus,
  _mocks,
} from '../services/browserChromium';

beforeEach(() => {
  _mocks.invoke = null;
});

afterEach(() => {
  _mocks.invoke = null;
});

// ── getChromiumStatus ─────────────────────────────────────────────────────────

describe('getChromiumStatus (#68)', () => {
  it('calls the browser_chromium_status command', async () => {
    let capturedCmd = '';
    _mocks.invoke = async (cmd) => {
      capturedCmd = cmd;
      return { found: true, source: 'system', path: '/Applications/Chrome', version: '124.0.0' };
    };
    await getChromiumStatus();
    expect(capturedCmd).toBe('browser_chromium_status');
  });

  it('returns a found system status with path and version', async () => {
    _mocks.invoke = async () =>
      ({
        found: true,
        source: 'system',
        path: '/usr/bin/google-chrome',
        version: '124.0.6367.207',
      } satisfies ChromiumStatus);
    const status = await getChromiumStatus();
    expect(status.found).toBe(true);
    expect(status.source).toBe('system');
    expect(status.path).toBe('/usr/bin/google-chrome');
    expect(status.version).toBe('124.0.6367.207');
  });

  it('returns a none status when no engine is found', async () => {
    _mocks.invoke = async () =>
      ({ found: false, source: 'none' } satisfies ChromiumStatus);
    const status = await getChromiumStatus();
    expect(status.found).toBe(false);
    expect(status.source).toBe('none');
    expect(status.path).toBeUndefined();
  });

  it('surfaces a downloaded engine as source "downloaded"', async () => {
    _mocks.invoke = async () =>
      ({
        found: true,
        source: 'downloaded',
        path: '/app-data/chromium/chrome',
        version: '120.0.0',
      } satisfies ChromiumStatus);
    const status = await getChromiumStatus();
    expect(status.source).toBe('downloaded');
    expect(status.found).toBe(true);
  });
});

// ── downloadChromium ──────────────────────────────────────────────────────────

describe('downloadChromium (#68, deferred)', () => {
  it('calls the browser_chromium_download command', async () => {
    let capturedCmd = '';
    _mocks.invoke = async (cmd) => {
      capturedCmd = cmd;
      return '/app-data/chromium/chrome';
    };
    await downloadChromium();
    expect(capturedCmd).toBe('browser_chromium_download');
  });

  it('resolves to the installed binary path on success', async () => {
    _mocks.invoke = async () => '/app-data/chromium/chrome';
    const path = await downloadChromium();
    expect(path).toBe('/app-data/chromium/chrome');
  });

  it('propagates the deferred error from the command', async () => {
    _mocks.invoke = async () => {
      throw new Error('Chromium download not yet implemented — locate a system install');
    };
    await expect(downloadChromium()).rejects.toThrow(/not yet implemented/);
  });
});

// ── needsChromiumPrompt ───────────────────────────────────────────────────────

describe('needsChromiumPrompt (#68)', () => {
  it('is true when no engine exists (source none)', () => {
    expect(needsChromiumPrompt({ found: false, source: 'none' })).toBe(true);
  });

  it('is false for a system install', () => {
    expect(
      needsChromiumPrompt({ found: true, source: 'system', path: '/usr/bin/chromium' }),
    ).toBe(false);
  });

  it('is false for a previously downloaded engine', () => {
    expect(
      needsChromiumPrompt({ found: true, source: 'downloaded', path: '/app-data/chromium/chrome' }),
    ).toBe(false);
  });
});
