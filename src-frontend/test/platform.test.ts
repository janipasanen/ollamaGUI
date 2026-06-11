import { describe, it, expect } from 'vitest';
import { probeBinary, pickDirectory, pickFile, appendPathArg } from '../services/platform';

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
