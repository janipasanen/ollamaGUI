/**
 * MCP pure helpers + server-manager registry (#54): transport-mock-free tests
 * for `normalizeToolsList` and the non-connecting `McpServerManager` methods.
 * (Transport-dependent paths are covered in mcp-transport.test.ts.)
 */
import { describe, it, expect } from 'vitest';
import { normalizeToolsList, McpServerManager, type McpServerConfig } from '../services/mcp';

function cfg(id: string, over: Partial<McpServerConfig> = {}): McpServerConfig {
  return { id, name: id, type: 'stdio', command: 'npx', args: ['x'], ...over };
}

describe('normalizeToolsList', () => {
  it('maps a {tools: [...]} result, converting inputSchema -> parameters', () => {
    const out = normalizeToolsList({ tools: [{ name: 'a', description: 'A', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } }] });
    expect(out).toEqual([{ name: 'a', description: 'A', parameters: { type: 'object', properties: { x: { type: 'string' } } } }]);
  });

  it('accepts a bare array of tools', () => {
    const out = normalizeToolsList([{ name: 'b', inputSchema: { type: 'object' } }]);
    expect(out).toEqual([{ name: 'b', description: '', parameters: { type: 'object' } }]);
  });

  it('defaults description to "" and parameters to an empty object schema', () => {
    const out = normalizeToolsList([{ name: 'c' }]);
    expect(out[0].description).toBe('');
    expect(out[0].parameters).toEqual({ type: 'object', properties: {} });
  });

  it('falls back to t.parameters when inputSchema is absent', () => {
    const out = normalizeToolsList([{ name: 'd', parameters: { type: 'string' } }]);
    expect(out[0].parameters).toEqual({ type: 'string' });
  });

  it('returns [] for empty/missing results', () => {
    expect(normalizeToolsList(undefined)).toEqual([]);
    expect(normalizeToolsList({})).toEqual([]);
    expect(normalizeToolsList([])).toEqual([]);
  });
});

describe('McpServerManager registry (non-connecting) (#54)', () => {
  it('addServer/getServer/getAllServers round-trip', () => {
    const mgr = new McpServerManager();
    mgr.addServer(cfg('s1'));
    mgr.addServer(cfg('s2'));
    expect(mgr.getServer('s1')?.id).toBe('s1');
    expect(mgr.getAllServers().map(s => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('getServer returns undefined for an unknown id', () => {
    expect(new McpServerManager().getServer('nope')).toBeUndefined();
  });

  it('addServer upserts by id', () => {
    const mgr = new McpServerManager();
    mgr.addServer(cfg('s1', { name: 'old' }));
    mgr.addServer(cfg('s1', { name: 'new' }));
    expect(mgr.getAllServers()).toHaveLength(1);
    expect(mgr.getServer('s1')?.name).toBe('new');
  });

  it('removeServer drops the config (no active connection to disconnect)', async () => {
    const mgr = new McpServerManager();
    mgr.addServer(cfg('s1'));
    await mgr.removeServer('s1');
    expect(mgr.getServer('s1')).toBeUndefined();
  });

  it('getActiveConnectionIds starts empty', () => {
    expect(new McpServerManager().getActiveConnectionIds()).toEqual([]);
  });

  it('getActiveConnection returns undefined when nothing is connected', () => {
    const mgr = new McpServerManager();
    mgr.addServer(cfg('s1'));
    expect(mgr.getActiveConnection('s1')).toBeUndefined();
  });

  it('connectToServer throws for an unknown server', async () => {
    await expect(new McpServerManager().connectToServer('nope')).rejects.toThrow(/not found/);
  });
});
