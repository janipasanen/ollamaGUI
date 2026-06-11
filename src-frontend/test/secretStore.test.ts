import { describe, it, expect, beforeEach } from 'vitest';
import { secretStore } from '../services/secretStore';
import { mcpConfigStore } from '../services/mcpConfig';
import type { McpServerConfig } from '../services/mcpConfig';

describe('secretStore (in-memory fallback) (#109)', () => {
  beforeEach(() => secretStore._clearMemory());

  it('round-trips set/get/delete', async () => {
    expect(await secretStore.get('k1')).toBeNull();
    await secretStore.set('k1', 'v1');
    expect(await secretStore.get('k1')).toBe('v1');
    await secretStore.delete('k1');
    expect(await secretStore.get('k1')).toBeNull();
  });

  it('does not write secrets to localStorage', async () => {
    await secretStore.set('apiKey', 'topsecret');
    expect(JSON.stringify(localStorage)).not.toContain('topsecret');
  });
});

describe('mcpConfigStore secret handling (#109)', () => {
  beforeEach(() => {
    localStorage.clear();
    secretStore._clearMemory();
  });

  const server: McpServerConfig = {
    id: 'srv1', name: 'GitHub', type: 'stdio',
    command: 'npx -y server-github',
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_secret123' },
    status: 'disconnected', tools: [], authRequired: false, authenticated: false,
  };

  it('keeps env KEY names in localStorage but never the secret VALUES', async () => {
    await mcpConfigStore.save(server);
    const blob = localStorage.getItem('mcp_servers')!;
    expect(blob).toContain('GITHUB_PERSONAL_ACCESS_TOKEN'); // key preserved
    expect(blob).not.toContain('ghp_secret123');           // value NOT in plaintext
  });

  it('rehydrates secret env values from the secret store on loadSecrets', async () => {
    await mcpConfigStore.save(server);
    const env = await mcpConfigStore.loadSecrets('srv1');
    expect(env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_secret123');
  });

  it('list() returns blanked env values (secrets not exposed)', async () => {
    await mcpConfigStore.save(server);
    const cfg = mcpConfigStore.list().find(s => s.id === 'srv1')!;
    expect(cfg.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('');
  });

  it('delete purges the secret from the store', async () => {
    await mcpConfigStore.save(server);
    await mcpConfigStore.delete('srv1');
    expect(await secretStore.get('env:srv1:GITHUB_PERSONAL_ACCESS_TOKEN')).toBeNull();
    expect(mcpConfigStore.list().find(s => s.id === 'srv1')).toBeUndefined();
  });
});
