/**
 * MCP → ToolRegistry bridge (#102).
 *
 * Extracts the inline App.tsx MCP tool registration/unregistration into a
 * tested service layer and makes toolsEnabled an actual filter:
 * - `toolsEnabled: false` on the server skips ALL tools.
 * - Individual McpTool.enabled === false skips that tool.
 */

import { mcpServerManager } from './mcp';
import { McpServerConfig } from './mcpConfig';
import { toolRegistry } from './tools';

/** Build the namespaced tool name for a given server/tool pair. */
export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp_${serverId}_${toolName}`;
}

/**
 * Discover tools for the given server and register enabled ones into
 * toolRegistry. Returns the list of registered tool names.
 *
 * Filtering:
 *  - Server-level: `toolsEnabled` (from mcp.ts ServerConfig) must be true.
 *  - Tool-level: `McpTool.enabled` must be true when the tools have been
 *    discovered and stored on the config.
 *
 * @param server        The McpServerConfig (runtime state from mcpConfigStore)
 * @param toolsEnabled  Whether this server's tools are enabled (default true)
 */
export async function registerMcpTools(
  server: Pick<McpServerConfig, 'id' | 'name'>,
  toolsEnabled: boolean = true
): Promise<string[]> {
  if (!toolsEnabled) return [];

  const client = mcpServerManager.getActiveConnection(server.id);
  if (!client) return [];

  const tools = await client.listTools();
  const registered: string[] = [];

  for (const tool of tools) {
    // Respect per-tool enabled flag (defaults to true when not set).
    if (tool.enabled === false) continue;
    const name = mcpToolName(server.id, tool.name);
    toolRegistry.registerTool({
      name,
      description: `[MCP:${server.name}] ${tool.description}`,
      parameters: (tool as any).parameters ?? { type: 'object', properties: {} },
      execute: async (params) => {
        const c = mcpServerManager.getActiveConnection(server.id);
        if (!c) throw new Error(`MCP server ${server.name} not connected`);
        return c.callTool(tool.name, params);
      },
    });
    registered.push(name);
  }
  return registered;
}

/**
 * Unregister all tools for a given server from toolRegistry.
 * Accepts either the list of previously registered names (preferred) or the
 * server config's current tools array.
 */
export function unregisterMcpTools(
  serverId: string,
  toolNames: string[]
): void {
  for (const name of toolNames) {
    toolRegistry.unregisterTool(name);
  }
}

/**
 * Derive the set of registered tool names from a McpServerConfig snapshot
 * (for use when the original registered-names list was not kept).
 */
export function getRegisteredToolNames(server: Pick<McpServerConfig, 'id' | 'tools'>): string[] {
  return server.tools.map(t => mcpToolName(server.id, t.name));
}
