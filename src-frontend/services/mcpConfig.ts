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
  /** HTTP authentication metadata used by the transport layer. */
  auth?: {
    token?: string;
    type?: 'bearer' | 'basic';
  };
  /** Epoch ms of the last successful connection (persisted; powers auto-reconnect #55). */
  lastConnected?: number;
  // runtime state (not persisted)
  status: McpServerStatus;
  errorMessage?: string;
  tools: McpTool[];
  authRequired: boolean;
  authenticated: boolean;
  /** Whether this server connection is enabled. */
  enabled?: boolean;
  /** Whether tools from this server are exposed to the agent. */
  toolsEnabled?: boolean;
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
    // Preserve the persisted value instead of hardcoding false (#521). It was
    // always reset on load, and since the only place it was ever set to true
    // touched React state alone, ANY later setMcpServers(mcpConfigStore.list())
    // — adding or deleting a server, or an app restart — silently flipped every
    // badge back to unauthenticated while the tokens were still valid in the
    // keychain. refreshAuthFlags() below reconciles it against the token store.
    authenticated: s.authenticated ?? false,
  };
}

function readPersisted(): PersistedServer[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist with QuotaExceededError guard (#470). */
function safePersist(servers: PersistedServer[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(servers)); }
  catch { /* QuotaExceededError — non-fatal, config stays in memory */ }
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
    safePersist(existing);
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
    safePersist(readPersisted().filter(s => s.id !== id));
  },

  /** Record a successful connection time (#55) so it can be auto-reconnected next launch. */
  markConnected(id: string, when: number = Date.now()): void {
    const existing = readPersisted();
    const idx = existing.findIndex(s => s.id === id);
    if (idx < 0) return;
    existing[idx] = { ...existing[idx], lastConnected: when };
    safePersist(existing);
  },

  /**
   * Servers eligible for auto-reconnect on app launch (#55): HTTP servers that
   * were connected before (have a lastConnected timestamp). Stdio servers are
   * excluded — they spawn processes and should be reconnected explicitly.
   */
  reconnectCandidates(): McpServerConfig[] {
    return readPersisted()
      .filter(s => s.type === 'http' && typeof s.lastConnected === 'number')
      .map(fromPersistedServer);
  },

  generateId(): string {
    return `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  },
};


/**
 * Reconcile each HTTP server's `authenticated` badge against the real token
 * store, and persist the result (#521).
 *
 * The badge is only ever meaningful if it reflects whether a usable token
 * actually exists — otherwise it either claims an authentication the user does
 * not have, or hides one they do, sending them through a whole OAuth
 * round-trip for tokens already sitting in the keychain.
 */
export async function refreshAuthFlags(servers: McpServerConfig[]): Promise<McpServerConfig[]> {
  const { tokenStore } = await import('./mcpAuth');
  const out = await Promise.all(servers.map(async (srv) => {
    if (srv.type !== 'http') return srv;
    try {
      const tokens = await tokenStore.load(srv.id);
      // A refresh_token can still redeem an expired access token.
      const usable = !!tokens && (!tokenStore.isExpired(tokens) || !!tokens.refresh_token);
      return usable === srv.authenticated ? srv : { ...srv, authenticated: usable };
    } catch {
      return srv; // keychain unavailable — leave the flag as-is rather than lying
    }
  }));
  if (out.some((s, i) => s !== servers[i])) {
    // Update ONLY the flag on the persisted records. Re-persisting whole
    // servers here would risk round-tripping the blanked env values that
    // list() hands back, so touch nothing else.
    const persisted = readPersisted();
    let changed = false;
    for (const srv of out) {
      const rec = persisted.find(r => r.id === srv.id);
      if (rec && rec.authenticated !== srv.authenticated) {
        rec.authenticated = srv.authenticated;
        changed = true;
      }
    }
    if (changed) safePersist(persisted);
  }
  return out;
}
