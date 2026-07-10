/**
 * Keychain wrapper (secrets.ts, #173/#225): the frontend never persists secret
 * values — only (service, key) refs are tracked in localStorage so the Settings
 * UI can list what exists. Verifies the Tauri command mapping + ref tracker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { secretSet, secretGet, secretDelete, secretListRefs } from '../services/secrets';

beforeEach(() => {
  invokeMock.mockReset();
  localStorage.clear();
});

describe('Keychain wrapper — secrets.ts (#225)', () => {
  it('secretSet invokes secret_set and tracks the (service, key) ref', async () => {
    invokeMock.mockResolvedValue(undefined);
    await secretSet('ollama-gui-mcp', 'apiKey', 'supersecret');
    expect(invokeMock).toHaveBeenCalledWith('secret_set', {
      service: 'ollama-gui-mcp', key: 'apiKey', value: 'supersecret',
    });
    expect(secretListRefs()).toContainEqual({ service: 'ollama-gui-mcp', key: 'apiKey' });
  });

  it('secretSet dedupes the tracker entry on re-set', async () => {
    invokeMock.mockResolvedValue(undefined);
    await secretSet('ollama-gui-mcp', 'apiKey', 'v1');
    await secretSet('ollama-gui-mcp', 'apiKey', 'v2');
    const refs = secretListRefs().filter(r => r.service === 'ollama-gui-mcp' && r.key === 'apiKey');
    expect(refs).toHaveLength(1);
  });

  it('secretGet invokes secret_get and returns the value', async () => {
    invokeMock.mockResolvedValue('the-value');
    const v = await secretGet('ollama-gui-mcp', 'apiKey');
    expect(invokeMock).toHaveBeenCalledWith('secret_get', { service: 'ollama-gui-mcp', key: 'apiKey' });
    expect(v).toBe('the-value');
  });

  it('secretGet returns null when the keychain returns null/undefined', async () => {
    invokeMock.mockResolvedValue(null);
    expect(await secretGet('ollama-gui-mcp', 'missing')).toBeNull();
    invokeMock.mockResolvedValue(undefined);
    expect(await secretGet('ollama-gui-mcp', 'missing')).toBeNull();
  });

  it('secretDelete invokes secret_delete and removes the tracker entry', async () => {
    invokeMock.mockResolvedValue(undefined);
    await secretSet('ollama-gui-mcp', 'apiKey', 'v');
    await secretDelete('ollama-gui-mcp', 'apiKey');
    expect(invokeMock).toHaveBeenCalledWith('secret_delete', { service: 'ollama-gui-mcp', key: 'apiKey' });
    expect(secretListRefs()).not.toContainEqual({ service: 'ollama-gui-mcp', key: 'apiKey' });
  });

  it('secretListRefs returns an empty array when nothing is tracked', () => {
    expect(secretListRefs()).toEqual([]);
  });

  it('secretListRefs survives localStorage corruption (returns [])', () => {
    localStorage.setItem('ollama_gui_secret_keys', '{not valid json');
    expect(secretListRefs()).toEqual([]);
  });

  it('round-trips set/get/delete through the keychain wrapper', async () => {
    const store = new Map<string, string>();
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      const k = `${args.service} ${args.key}`;
      if (cmd === 'secret_set') { store.set(k, args.value); return undefined; }
      if (cmd === 'secret_get') { return store.get(k) ?? null; }
      if (cmd === 'secret_delete') { store.delete(k); return undefined; }
      return undefined;
    });

    await secretSet('ollama-gui-mcp', 'token', 'abc123');
    expect(await secretGet('ollama-gui-mcp', 'token')).toBe('abc123');
    expect(secretListRefs()).toContainEqual({ service: 'ollama-gui-mcp', key: 'token' });

    await secretDelete('ollama-gui-mcp', 'token');
    expect(await secretGet('ollama-gui-mcp', 'token')).toBeNull();
    expect(secretListRefs()).toEqual([]);
  });
});
