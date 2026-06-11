import { describe, it, expect } from 'vitest';
import { probeBinary, pickDirectory, pickFile } from '../services/platform';

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
