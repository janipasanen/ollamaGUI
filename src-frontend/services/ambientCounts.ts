/**
 * Derive the set of "active configuration" counts for the ambient header
 * indicator (#547).
 *
 * A configuration entry counts as active when:
 *   - MCP server: enabled and currently connected
 *   - Custom tool: enabled
 *   - OpenAPI server: enabled
 *   - Knowledge collection: present (all are indexed on read)
 *   - Secret: present in the secret store
 */

import type { McpServerConfig } from './mcpConfig';
import type { CustomTool } from './customTools';
import type { OpenApiServerConfig } from './openapiTools';

/** Active = enabled and connected. */
export function countActiveMcpServers(servers: McpServerConfig[]): number {
  return servers.filter((s) => s.enabled && s.status === 'connected').length;
}

/** Active = enabled. */
export function countEnabledCustomTools(tools: CustomTool[]): number {
  return tools.filter((t) => t.enabled).length;
}

/** Active = enabled. */
export function countEnabledOpenApiServers(configs: OpenApiServerConfig[]): number {
  return configs.filter((c) => c.enabled).length;
}

/** Count of knowledge collections (array length is the source of truth). */
export function countKnowledgeCollections(collections: unknown[]): number {
  return collections.length;
}

/** Count of stored secrets (array length is the source of truth). */
export function countSecrets(entries: unknown[]): number {
  return entries.length;
}
