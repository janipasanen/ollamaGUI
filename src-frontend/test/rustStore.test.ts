// Durable store mirror service: debounced write-through to the Rust backend.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { mirrorToDisk, loadFromDisk, hasTauri, _clearPendingMirrors } from '../services/rustStore';

describe('rustStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
  });

  afterEach(() => {
    _clearPendingMirrors();
    vi.useRealTimers();
  });

  it('debounces rapid mirrors for a key into ONE write of the latest payload', async () => {
    mirrorToDisk('sessions', '["v1"]');
    mirrorToDisk('sessions', '["v2"]');
    mirrorToDisk('sessions', '["v3"]');

    // Trailing edge: nothing flushed before the window elapses.
    await vi.advanceTimersByTimeAsync(499);
    expect(invokeMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('persist_store', { key: 'sessions', json: '["v3"]' });
  });

  it('debounces per key — different keys flush independently', async () => {
    mirrorToDisk('sessions', '[1]');
    mirrorToDisk('projects', '[2]');
    await vi.advanceTimersByTimeAsync(500);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenCalledWith('persist_store', { key: 'sessions', json: '[1]' });
    expect(invokeMock).toHaveBeenCalledWith('persist_store', { key: 'projects', json: '[2]' });
  });

  it('a save after the debounce window triggers a second write', async () => {
    mirrorToDisk('sessions', '[1]');
    await vi.advanceTimersByTimeAsync(500);
    mirrorToDisk('sessions', '[2]');
    await vi.advanceTimersByTimeAsync(500);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith('persist_store', { key: 'sessions', json: '[2]' });
  });

  it('loadFromDisk returns the persisted payload', async () => {
    invokeMock.mockResolvedValueOnce('[{"id":"s1"}]');
    await expect(loadFromDisk('sessions')).resolves.toBe('[{"id":"s1"}]');
    expect(invokeMock).toHaveBeenCalledWith('load_store', { key: 'sessions' });
  });

  it('loadFromDisk maps undefined/null (never persisted) to null', async () => {
    invokeMock.mockResolvedValueOnce(null);
    await expect(loadFromDisk('sessions')).resolves.toBeNull();
  });

  it('hasTauri is false in jsdom (no __TAURI_INTERNALS__)', () => {
    expect(hasTauri()).toBe(false);
  });

  it('hasTauri is true when the Tauri runtime global is present', () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      expect(hasTauri()).toBe(true);
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });

  it('is a silent no-op when invoke fails (outside Tauri the command throws)', async () => {
    invokeMock.mockRejectedValue(new Error('window.__TAURI_INTERNALS__ is undefined'));
    // mirrorToDisk must neither throw nor produce an unhandled rejection.
    mirrorToDisk('sessions', '[1]');
    await vi.advanceTimersByTimeAsync(500);
    await expect(loadFromDisk('sessions')).resolves.toBeNull();
  });
});
