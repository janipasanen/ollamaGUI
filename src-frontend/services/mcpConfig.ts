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

function fromPersistedServer(s: PersistedServer): McpServerConfig {
  return {
    ...s,
    status: 'disconnected',
    tools: [],
    authRequired: s.authRequired ?? false,
    authenticated: false,
  };
}

export const mcpConfigStore = {
  list(): McpServerConfig[] {
    const raw: PersistedServer[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '[]'
    );
    return raw.map(fromPersistedServer);
  },

  save(server: McpServerConfig): void {
    const all = this.list();
    const idx = all.findIndex(s => s.id === server.id);
    const persisted = toPersistedServer(server);
    if (idx >= 0) {
      const existing: PersistedServer[] = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? '[]'
      );
      existing[idx] = persisted;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    } else {
      const existing: PersistedServer[] = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? '[]'
      );
      existing.push(persisted);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    }
  },

  delete(id: string): void {
    const existing: PersistedServer[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '[]'
    );
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(existing.filter(s => s.id !== id))
    );
  },

  generateId(): string {
    return `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  },
};
