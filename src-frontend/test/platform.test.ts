import { describe, it, expect } from 'vitest';
import { probeBinary, pickDirectory, pickFile, appendPathArg, safeSetItem } from '../services/platform';

describe('appendPathArg (#111)', () => {
  it('appends a plain path', () => {
    expect(appendPathArg('npx -y server-fs', '/home/me/proj')).toBe('npx -y server-fs /home/me/proj');
  });
  it('quotes a path containing spaces', () => {
    expect(appendPathArg('npx -y server-fs', '/Users/me/My Project')).toBe('npx -y server-fs "/Users/me/My Project"');
  });
  it('handles an empty command', () => {
    expect(appendPathArg('', '/a/b')).toBe('/a/b');
  });
});

// In jsdom there is no Tauri IPC, so invoke()/dialog open() reject — the wrappers
// must degrade gracefully (false / null) rather than throw.
describe('platform helpers (Tauri-unavailable fallbacks) (#105)', () => {
  it('probeBinary returns false when Tauri is unavailable', async () => {
    await expect(probeBinary('docker')).resolves.toBe(false);
  });

  it('pickDirectory returns null when Tauri is unavailable', async () => {
    await expect(pickDirectory()).resolves.toBeNull();
  });

  it('pickFile returns null when Tauri is unavailable', async () => {
    await expect(pickFile()).resolves.toBeNull();
  });
});

// ── #473: safeSetItem must not throw on QuotaExceededError ───────────────────

describe('safeSetItem (#473)', () => {
  let origSetItem: typeof Storage.prototype.setItem;
  beforeEach(() => {
    localStorage.clear();
    origSetItem = Storage.prototype.setItem;
  });
  afterEach(() => { Storage.prototype.setItem = origSetItem; });

  it('stores a value normally', () => {
    safeSetItem('test_key', 'test_value');
    expect(localStorage.getItem('test_key')).toBe('test_value');
  });

  it('does not throw on QuotaExceededError (#473)', () => {
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    expect(() => safeSetItem('test_key', 'test_value')).not.toThrow();
  });

  it('does not throw on other DOMException (#473)', () => {
    Storage.prototype.setItem = () => { throw new DOMException('access denied', 'SecurityError'); };
    expect(() => safeSetItem('test_key', 'test_value')).not.toThrow();
  });
});

// ── #474: safeSessionSetItem must not throw on QuotaExceededError ───────────

describe('safeSessionSetItem (#474)', () => {
  let origSetItem: typeof Storage.prototype.setItem;
  beforeEach(() => {
    sessionStorage.clear();
    origSetItem = Storage.prototype.setItem;
  });
  afterEach(() => { Storage.prototype.setItem = origSetItem; });

  it('stores a value normally', () => {
    safeSessionSetItem('sess_key', 'sess_value');
    expect(sessionStorage.getItem('sess_key')).toBe('sess_value');
  });

  it('does not throw on QuotaExceededError (#474)', () => {
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    expect(() => safeSessionSetItem('sess_key', 'sess_value')).not.toThrow();
  });

  it('does not throw on other DOMException (#474)', () => {
    Storage.prototype.setItem = () => { throw new DOMException('access denied', 'SecurityError'); };
    expect(() => safeSessionSetItem('sess_key', 'sess_value')).not.toThrow();
  });
});
import { safeSessionSetItem } from '../services/platform';
