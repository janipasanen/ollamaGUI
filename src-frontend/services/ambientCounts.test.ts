import { describe, expect, it } from 'vitest';
import {
  countActiveMcpServers,
  countEnabledCustomTools,
  countEnabledOpenApiServers,
  countKnowledgeCollections,
  countSecrets,
} from './ambientCounts';
import type { McpServerConfig } from './mcpConfig';
import type { CustomTool } from './customTools';
import type { OpenApiServerConfig } from './openapiTools';

const mcp = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 'x',
  name: 'x',
  type: 'stdio',
  enabled: true,
  status: 'disconnected',
  tools: [],
  authRequired: false,
  authenticated: false,
  ...overrides,
});

const tool = (overrides: Partial<CustomTool> = {}): CustomTool => ({
  id: 't',
  name: 't',
  description: '',
  parameters: { type: 'object', properties: { input: { type: 'string', description: 'i' } } },
  code: 'return {};',
  enabled: true,
  ...overrides,
});

const oapi = (overrides: Partial<OpenApiServerConfig> = {}): OpenApiServerConfig => ({
  id: 'o',
  name: 'o',
  specUrl: 'http://x/openapi.json',
  enabled: true,
  ...overrides,
});

describe('countActiveMcpServers', () => {
  it('counts only enabled+connected servers', () => {
    expect(countActiveMcpServers([
      mcp({ status: 'connected' }),
      mcp({ status: 'disconnected' }),
      mcp({ status: 'connected', enabled: false }),
      mcp({ status: 'connecting' }),
    ])).toBe(1);
  });
});

describe('countEnabledCustomTools', () => {
  it('counts only enabled tools', () => {
    expect(countEnabledCustomTools([tool(), tool({ enabled: false })])).toBe(1);
  });
});

describe('countEnabledOpenApiServers', () => {
  it('counts only enabled servers', () => {
    expect(countEnabledOpenApiServers([oapi(), oapi({ enabled: false })])).toBe(1);
  });
});

describe('countKnowledgeCollections / countSecrets', () => {
  it('use array length as source of truth', () => {
    expect(countKnowledgeCollections(['a', 'b'])).toBe(2);
    expect(countSecrets(['a', 'b', 'c'])).toBe(3);
    expect(countKnowledgeCollections([])).toBe(0);
    expect(countSecrets([])).toBe(0);
  });
});
