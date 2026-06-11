import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  McpServerManager,
  registerMcpShutdownHandler,
  _resetShutdownHandler,
} from '../services/mcp';
import { mcpConfigStore, type McpServerConfig } from '../services/mcpConfig';

beforeEach(() => {
  _resetShutdownHandler();
  localStorage.clear();
});

// ── #54 graceful shutdown ───────────────────────────────────────────────────────

describe('McpServerManager.disconnectAll (#54)', () => {
  it('resolves with no active connections', async () => {
    const mgr = new McpServerManager();
    await expect(mgr.disconnectAll()).resolves.toBeUndefined();
    expect(mgr.getActiveConnectionIds()).toEqual([]);
  });

  it('getActiveConnectionIds starts empty', () => {
    const mgr = new McpServerManager();
    expect(mgr.getActiveConnectionIds()).toEqual([]);
  });
});

describe('registerMcpShutdownHandler (#54)', () => {
  it('registers a beforeunload listener that calls disconnectAll', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const mgr = new McpServerManager();
    const disc = vi.spyOn(mgr, 'disconnectAll').mockResolvedValue(undefined);

    registerMcpShutdownHandler(mgr);

    const call = addSpy.mock.calls.find(c => c[0] === 'beforeunload');
    expect(call).toBeDefined();
    // Invoke the registered handler and confirm it triggers disconnectAll.
    (call![1] as EventListener)(new Event('beforeunload'));
    expect(disc).toHaveBeenCalled();
    addSpy.mockRestore();
  });

  it('is idempotent (only registers once)', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    registerMcpShutdownHandler(new McpServerManager());
    const countAfterFirst = addSpy.mock.calls.filter(c => c[0] === 'beforeunload').length;
    registerMcpShutdownHandler(new McpServerManager());
    const countAfterSecond = addSpy.mock.calls.filter(c => c[0] === 'beforeunload').length;
    expect(countAfterSecond).toBe(countAfterFirst);
    addSpy.mockRestore();
  });
});

// ── #55 auto-reconnect ──────────────────────────────────────────────────────────

function httpServer(id: string, extra: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id, name: id, type: 'http', url: 'https://example.com/mcp',
    status: 'disconnected', tools: [], authRequired: false, authenticated: false,
    ...extra,
  };
}

describe('mcpConfigStore.markConnected / reconnectCandidates (#55)', () => {
  it('records a lastConnected timestamp', async () => {
    await mcpConfigStore.save(httpServer('s1'));
    mcpConfigStore.markConnected('s1', 1234);
    const loaded = mcpConfigStore.list().find(s => s.id === 's1');
    expect(loaded?.lastConnected).toBe(1234);
  });

  it('reconnectCandidates includes previously-connected http servers', async () => {
    await mcpConfigStore.save(httpServer('s1', { lastConnected: 1000 }));
    const candidates = mcpConfigStore.reconnectCandidates();
    expect(candidates.map(c => c.id)).toContain('s1');
  });

  it('excludes http servers never connected', async () => {
    await mcpConfigStore.save(httpServer('fresh'));
    expect(mcpConfigStore.reconnectCandidates().map(c => c.id)).not.toContain('fresh');
  });

  it('excludes stdio servers even if previously connected', async () => {
    await mcpConfigStore.save({
      id: 'std', name: 'std', type: 'stdio', command: 'npx server',
      lastConnected: 5000,
      status: 'disconnected', tools: [], authRequired: false, authenticated: false,
    });
    expect(mcpConfigStore.reconnectCandidates().map(c => c.id)).not.toContain('std');
  });

  it('markConnected on an unknown id is a no-op', () => {
    expect(() => mcpConfigStore.markConnected('nope', 1)).not.toThrow();
    expect(mcpConfigStore.reconnectCandidates()).toEqual([]);
  });
});
