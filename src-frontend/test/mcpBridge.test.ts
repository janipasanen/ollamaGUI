import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerMcpTools, unregisterMcpTools, getRegisteredToolNames, mcpToolName } from '../services/mcpBridge';
import { toolRegistry } from '../services/tools';

// Mock the MCP server manager
vi.mock('../services/mcp', () => ({
  mcpServerManager: {
    getActiveConnection: vi.fn(),
  },
}));

import { mcpServerManager } from '../services/mcp';

const mockCallTool = vi.fn();
const mockListTools = vi.fn();
const mockConnection = { listTools: mockListTools, callTool: mockCallTool };

beforeEach(() => {
  vi.mocked(mcpServerManager.getActiveConnection).mockReturnValue(mockConnection as any);
  mockListTools.mockReset();
  mockCallTool.mockReset();
});

afterEach(() => {
  // Clean up any registered tools
  ['mcp_srv1_tool_a', 'mcp_srv1_tool_b', 'mcp_srv2_tool_x'].forEach(name => {
    try { toolRegistry.unregisterTool(name); } catch { /* already removed */ }
  });
});

// ── mcpToolName ───────────────────────────────────────────────────────────────

describe('mcpToolName', () => {
  it('produces the namespaced tool name', () => {
    expect(mcpToolName('server1', 'search')).toBe('mcp_server1_search');
  });
});

// ── registerMcpTools ──────────────────────────────────────────────────────────

describe('registerMcpTools', () => {
  it('registers tools with the correct namespaced name', async () => {
    mockListTools.mockResolvedValue([
      { name: 'tool_a', description: 'Tool A', enabled: true },
    ]);
    const names = await registerMcpTools({ id: 'srv1', name: 'My Server' });
    expect(names).toEqual(['mcp_srv1_tool_a']);
    expect(toolRegistry.getAllTools().find(t => t.name === 'mcp_srv1_tool_a')).toBeDefined();
  });

  it('includes server name in description', async () => {
    mockListTools.mockResolvedValue([
      { name: 'tool_a', description: 'Does A', enabled: true },
    ]);
    await registerMcpTools({ id: 'srv1', name: 'My Server' });
    const tool = toolRegistry.getAllTools().find(t => t.name === 'mcp_srv1_tool_a');
    expect(tool?.description).toContain('My Server');
    expect(tool?.description).toContain('Does A');
  });

  it('returns empty array when toolsEnabled is false', async () => {
    mockListTools.mockResolvedValue([
      { name: 'tool_a', description: 'Does A', enabled: true },
    ]);
    const names = await registerMcpTools({ id: 'srv1', name: 'Server' }, false);
    expect(names).toHaveLength(0);
    expect(toolRegistry.getAllTools().find(t => t.name === 'mcp_srv1_tool_a')).toBeUndefined();
  });

  it('skips tools with enabled=false', async () => {
    mockListTools.mockResolvedValue([
      { name: 'tool_a', description: 'Active', enabled: true },
      { name: 'tool_b', description: 'Disabled', enabled: false },
    ]);
    const names = await registerMcpTools({ id: 'srv1', name: 'Server' });
    expect(names).toContain('mcp_srv1_tool_a');
    expect(names).not.toContain('mcp_srv1_tool_b');
  });

  it('returns empty when no active connection', async () => {
    vi.mocked(mcpServerManager.getActiveConnection).mockReturnValue(undefined);
    const names = await registerMcpTools({ id: 'srv1', name: 'Server' });
    expect(names).toHaveLength(0);
  });

  it('execute dispatches to callTool with correct params', async () => {
    mockListTools.mockResolvedValue([
      { name: 'tool_a', description: 'A', enabled: true },
    ]);
    mockCallTool.mockResolvedValue({ result: 'ok' });
    await registerMcpTools({ id: 'srv1', name: 'Server' });
    const tool = toolRegistry.getAllTools().find(t => t.name === 'mcp_srv1_tool_a')!;
    const result = await tool.execute({ query: 'test' });
    expect(mockCallTool).toHaveBeenCalledWith('tool_a', { query: 'test' });
    expect(result).toEqual({ result: 'ok' });
  });

  it('execute throws when connection is gone at call time', async () => {
    mockListTools.mockResolvedValue([
      { name: 'tool_a', description: 'A', enabled: true },
    ]);
    await registerMcpTools({ id: 'srv1', name: 'Server' });
    vi.mocked(mcpServerManager.getActiveConnection).mockReturnValue(undefined);
    const tool = toolRegistry.getAllTools().find(t => t.name === 'mcp_srv1_tool_a')!;
    await expect(tool.execute({})).rejects.toThrow('not connected');
  });
});

// ── unregisterMcpTools ────────────────────────────────────────────────────────

describe('unregisterMcpTools', () => {
  it('removes previously registered tools', async () => {
    mockListTools.mockResolvedValue([
      { name: 'tool_a', description: 'A', enabled: true },
    ]);
    const names = await registerMcpTools({ id: 'srv1', name: 'Server' });
    unregisterMcpTools('srv1', names);
    expect(toolRegistry.getAllTools().find(t => t.name === 'mcp_srv1_tool_a')).toBeUndefined();
  });
});

// ── getRegisteredToolNames ────────────────────────────────────────────────────

describe('getRegisteredToolNames', () => {
  it('derives namespaced names from server config', () => {
    const server = {
      id: 'srv2',
      tools: [
        { name: 'tool_x', description: 'X', enabled: true },
      ],
    };
    expect(getRegisteredToolNames(server as any)).toEqual(['mcp_srv2_tool_x']);
  });
});
