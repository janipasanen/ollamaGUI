/**
 * MCP config store (#55, #173): persistence, secret env handling, and
 * auto-reconnect eligibility. Secret env VALUES are never persisted to
 * localStorage — they live in the keychain (here a mocked invoke map) and are
 * rehydrated on connect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api', () => ({ invoke: invokeMock }));

import { mcpConfigStore, type McpServerConfig } from '../services/mcpConfig';
import { secretStore } from '../services/secretStore';

function makeServer(over: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 's1', name: 'test', type: 'stdio', command: 'npx', args: ['x'],
    env: { TOKEN: 'supersecret' }, status: 'connected', tools: [],
    authRequired: false, authenticated: false, ...over,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  localStorage.clear();
  secretStore._clearMemory();
  // In-memory keychain backed by a Map.
  const store = new Map<string, string>();
  invokeMock.mockImplementation(async (cmd: string, args: any) => {
    const k = `${args.service}::${args.key}`;
    if (cmd === 'secret_set') { store.set(k, args.value); return undefined; }
    if (cmd === 'secret_get') { return store.get(k) ?? null; }
    if (cmd === 'secret_delete') { store.delete(k); return undefined; }
    return undefined;
  });
});

describe('mcpConfigStore persistence + secret env (#55/#173)', () => {
  it('save() persists the config but blanks env VALUES in localStorage', async () => {
    await mcpConfigStore.save(makeServer());
    const raw = JSON.parse(localStorage.getItem('mcp_servers') ?? '[]');
    expect(raw).toHaveLength(1);
    expect(raw[0].env).toEqual({ TOKEN: '' });
    expect(raw[0].status).toBeUndefined(); // runtime state not persisted
    expect(raw[0].tools).toBeUndefined();
  });

  it('save() stores the secret env value in the keychain', async () => {
    await mcpConfigStore.save(makeServer());
    const v = await secretStore.get('env:s1:TOKEN');
    expect(v).toBe('supersecret');
  });

  it('list() returns configs with blank env values (secrets not leaked)', async () => {
    await mcpConfigStore.save(makeServer());
    const listed = mcpConfigStore.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].env).toEqual({ TOKEN: '' });
    expect(listed[0].status).toBe('disconnected'); // runtime reset
    expect(listed[0].tools).toEqual([]);
  });

  it('loadSecrets() rehydrates env values from the keychain', async () => {
    await mcpConfigStore.save(makeServer());
    const env = await mcpConfigStore.loadSecrets('s1');
    expect(env).toEqual({ TOKEN: 'supersecret' });
  });

  it('loadSecrets() returns {} for an unknown server', async () => {
    expect(await mcpConfigStore.loadSecrets('nope')).toEqual({});
  });

  it('delete() removes the config and purges its env + token secrets', async () => {
    await mcpConfigStore.save(makeServer());
    expect(await secretStore.get('env:s1:TOKEN')).toBe('supersecret');
    await mcpConfigStore.delete('s1');
    expect(mcpConfigStore.list()).toHaveLength(0);
    expect(await secretStore.get('env:s1:TOKEN')).toBeNull();
    expect(await secretStore.get('tokens:s1')).toBeNull();
  });

  it('save() updates an existing server in place (by id)', async () => {
    await mcpConfigStore.save(makeServer({ name: 'old' }));
    await mcpConfigStore.save(makeServer({ name: 'new' }));
    const listed = mcpConfigStore.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('new');
  });

  it('does not store empty env values in the keychain', async () => {
    await mcpConfigStore.save(makeServer({ env: { TOKEN: '' } }));
    expect(await secretStore.get('env:s1:TOKEN')).toBeNull();
  });
});

describe('mcpConfigStore reconnect candidates (#55)', () => {
  it('only http servers with a lastConnected timestamp are candidates', async () => {
    await mcpConfigStore.save(makeServer({ id: 'stdio1', type: 'stdio', lastConnected: 1000 }));
    await mcpConfigStore.save(makeServer({ id: 'http1', type: 'http', url: 'http://x', lastConnected: 1000 }));
    await mcpConfigStore.save(makeServer({ id: 'http2', type: 'http', url: 'http://y' }));
    const ids = mcpConfigStore.reconnectCandidates().map(s => s.id);
    expect(ids).toEqual(['http1']);
  });

  it('markConnected records a lastConnected timestamp', async () => {
    await mcpConfigStore.save(makeServer({ id: 'http1', type: 'http', url: 'http://x' }));
    mcpConfigStore.markConnected('http1', 4242);
    expect(mcpConfigStore.reconnectCandidates().map(s => s.id)).toEqual(['http1']);
  });

  it('markConnected is a no-op for an unknown server', () => {
    mcpConfigStore.markConnected('nope', 1);
    expect(mcpConfigStore.reconnectCandidates()).toHaveLength(0);
  });
});

describe('mcpConfigStore.generateId', () => {
  it('generates unique mcp_ ids', () => {
    const a = mcpConfigStore.generateId();
    const b = mcpConfigStore.generateId();
    expect(a).toMatch(/^mcp_/);
    expect(a).not.toBe(b);
  });
});


// ── #452: readPersisted must handle corrupted localStorage ──────────────────

describe('mcpConfigStore corrupted localStorage (#452)', () => {
  it('list() returns [] when localStorage data is corrupted', () => {
    localStorage.setItem('mcp_servers', '{not valid json');
    expect(mcpConfigStore.list()).toEqual([]);
  });

  it('list() returns [] when localStorage data is a non-array type', () => {
    localStorage.setItem('mcp_servers', '"a string"');
    // A string is valid JSON but not an array — list should handle gracefully
    const result = mcpConfigStore.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── #470: setItem QuotaExceededError must not crash MCP config ops ────────────

describe('mcpConfigStore QuotaExceededError handling (#470)', () => {
  function makeServer(over: Partial<McpServerConfig> = {}): McpServerConfig {
    return {
      id: 'quota1', name: 'Q1', type: 'http', url: 'http://x', enabled: true, toolsEnabled: true,
      ...over,
    } as McpServerConfig;
  }

  let origSetItem: typeof Storage.prototype.setItem;
  beforeEach(() => {
    localStorage.clear();
    origSetItem = Storage.prototype.setItem;
  });
  afterEach(() => { Storage.prototype.setItem = origSetItem; });

  function quotaSetItem(): void {
    Storage.prototype.setItem = vi.fn(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
  }

  it('save() does not throw on QuotaExceededError (#470)', async () => {
    quotaSetItem();
    await expect(mcpConfigStore.save(makeServer())).resolves.toBeUndefined();
  });

  it('delete() does not throw on QuotaExceededError (#470)', async () => {
    // First save normally so the server exists
    await mcpConfigStore.save(makeServer());
    quotaSetItem();
    await expect(mcpConfigStore.delete('quota1')).resolves.toBeUndefined();
  });

  it('markConnected() does not throw on QuotaExceededError (#470)', async () => {
    await mcpConfigStore.save(makeServer());
    quotaSetItem();
    expect(() => mcpConfigStore.markConnected('quota1', 9999)).not.toThrow();
  });
});
