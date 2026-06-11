import { secretStore } from './secretStore';

export type McpServerType = 'stdio' | 'http';
export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpTool {
  name: string;
  description: string;
  enabled: boolean;
}

export interface McpServerConfig {
  id: string;
  name: string;
  type: McpServerType;
  // stdio servers
  command?: string;
  args?: string[];
  /** Per-server environment variables (e.g. credential tokens) for stdio servers. */
  env?: Record<string, string>;
  // http servers
  url?: string;
  /** Extra HTTP headers forwarded on every request (e.g. X-Gitlab-Mcp-Server-Tool-Name-Prefix). */
  headers?: Record<string, string>;
  // runtime state (not persisted)
  status: McpServerStatus;
  errorMessage?: string;
  tools: McpTool[];
  authRequired: boolean;
  authenticated: boolean;
}

const STORAGE_KEY = 'mcp_servers';

type PersistedServer = Omit<McpServerConfig, 'status' | 'errorMessage' | 'tools'>;

function toPersistedServer(s: McpServerConfig): PersistedServer {
  const { status: _s, errorMessage: _e, tools: _t, ...rest } = s;
  return rest;
}

/** Blank out env VALUES (keep keys) so secrets never persist in localStorage. */
function blankEnvValues(s: PersistedServer): PersistedServer {
  if (!s.env) return s;
  return { ...s, env: Object.fromEntries(Object.keys(s.env).map(k => [k, ''])) };
}

function fromPersistedServer(s: PersistedServer): McpServerConfig {
  return {
    ...s,
    status: 'disconnected',
    tools: [],
    authRequired: s.authRequired ?? false,
    authenticated: false,
  };
}

function readPersisted(): PersistedServer[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
}

const envSecretKey = (serverId: string, envKey: string) => `env:${serverId}:${envKey}`;

export const mcpConfigStore = {
  /** Synchronous: returns configs with env VALUES blank (secrets live in the keychain). */
  list(): McpServerConfig[] {
    return readPersisted().map(fromPersistedServer);
  },

  /** Persist config (env values blanked) and store secret env values in the keychain. */
  async save(server: McpServerConfig): Promise<void> {
    if (server.env) {
      for (const [k, v] of Object.entries(server.env)) {
        if (v) await secretStore.set(envSecretKey(server.id, k), v);
      }
    }
    const persisted = blankEnvValues(toPersistedServer(server));
    const existing = readPersisted();
    const idx = existing.findIndex(s => s.id === server.id);
    if (idx >= 0) existing[idx] = persisted; else existing.push(persisted);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  },

  /** Rehydrate a server's env values from the keychain (call at connect time). */
  async loadSecrets(serverId: string): Promise<Record<string, string>> {
    const cfg = readPersisted().find(s => s.id === serverId);
    const env: Record<string, string> = {};
    if (cfg?.env) {
      for (const k of Object.keys(cfg.env)) {
        const v = await secretStore.get(envSecretKey(serverId, k));
        if (v != null) env[k] = v;
      }
    }
    return env;
  },

  /** Remove the server and purge its secrets (env values + OAuth tokens) from the keychain. */
  async delete(id: string): Promise<void> {
    const cfg = readPersisted().find(s => s.id === id);
    if (cfg?.env) {
      for (const k of Object.keys(cfg.env)) await secretStore.delete(envSecretKey(id, k));
    }
    await secretStore.delete(`tokens:${id}`);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readPersisted().filter(s => s.id !== id)));
  },

  generateId(): string {
    return `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  },
};
