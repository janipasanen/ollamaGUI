import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Tauri invoke API so secretStore uses the keychain-wrapper path
// (invoke('secret_set'/'secret_get'/'secret_delete')) instead of the in-memory
// fallback (#225).
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api', () => ({ invoke: invokeMock }));

import { secretStore } from '../services/secretStore';

describe('secretStore Tauri keychain wrapper (#225)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    secretStore._clearMemory();
  });

  it('set() invokes secret_set with service, key, value', async () => {
    invokeMock.mockResolvedValue(undefined);
    await secretStore.set('apiKey', 'supersecret', 'ollama-gui-mcp');
    expect(invokeMock).toHaveBeenCalledWith('secret_set', {
      service: 'ollama-gui-mcp',
      key: 'apiKey',
      value: 'supersecret',
    });
  });

  it('get() invokes secret_get and returns the stored value', async () => {
    invokeMock.mockResolvedValue('the-value');
    const v = await secretStore.get('apiKey', 'ollama-gui-mcp');
    expect(invokeMock).toHaveBeenCalledWith('secret_get', { service: 'ollama-gui-mcp', key: 'apiKey' });
    expect(v).toBe('the-value');
  });

  it('get() returns null when the keychain returns null/undefined', async () => {
    invokeMock.mockResolvedValue(null);
    expect(await secretStore.get('missing')).toBeNull();
    invokeMock.mockResolvedValue(undefined);
    expect(await secretStore.get('missing')).toBeNull();
  });

  it('delete() invokes secret_delete with service and key', async () => {
    invokeMock.mockResolvedValue(undefined);
    await secretStore.delete('apiKey', 'ollama-gui-mcp');
    expect(invokeMock).toHaveBeenCalledWith('secret_delete', { service: 'ollama-gui-mcp', key: 'apiKey' });
  });

  it('falls back to the in-memory store when invoke rejects', async () => {
    invokeMock.mockRejectedValue(new Error('no keychain'));
    await secretStore.set('k', 'v');
    // Should not have thrown; the in-memory fallback holds the value and a
    // rejecting get() also falls back to memory.
    expect(await secretStore.get('k')).toBe('v');
  });

  it('round-trips set/get/delete through the keychain wrapper', async () => {
    const store = new Map<string, string>();
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      const k = `${args.service} ${args.key}`;
      if (cmd === 'secret_set') { store.set(k, args.value); return undefined; }
      if (cmd === 'secret_get') { return store.get(k) ?? null; }
      if (cmd === 'secret_delete') { store.delete(k); return undefined; }
    });
    expect(await secretStore.get('tok')).toBeNull();
    await secretStore.set('tok', 'abc123');
    expect(await secretStore.get('tok')).toBe('abc123');
    await secretStore.delete('tok');
    expect(await secretStore.get('tok')).toBeNull();
  });
});
