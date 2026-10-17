/**
 * OpenAPI tool servers (#129): auto-discover tools from any OpenAPI 3.x endpoint.
 * Parses a spec into ToolDefinitions and registers them into toolRegistry.
 * HTTP calls route through the Rust mcp_http_request command to avoid CORS.
 */
import { toolRegistry, type ToolDefinition } from './tools';
import { secretStore } from './secretStore';

const STORAGE_KEY = 'openapi_servers';

// ── Persistence (#611) ───────────────────────────────────────────────────────
//
// API keys live in the OS keychain via `secretStore`. localStorage records only
// a presence flag (`hasApiKey`), so plaintext keys never touch storage. A
// boot-hydrated in-memory cache backs the sync accessors; writes go to both
// the cache and the keychain.

/** Keychain namespace for OpenAPI server API keys. */
const openapiSecretKey = (id: string): string => `openapi:${id}`;

/** Module-level cache hydrated once at boot. */
const openapiApiKeyCache = new Map<string, string>();

/** Strip the live key, keep a presence flag, for persistence. */
function toPersistedServer(config: OpenApiServerConfig): Omit<OpenApiServerConfig, 'apiKey'> {
  const { apiKey, ...rest } = config;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

/** Write a (already redacted) server array to localStorage. */
function persistOpenApiServers(conns: Omit<OpenApiServerConfig, 'apiKey'>[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(conns)); } catch { /* quota */ }
}

/** Sync accessor for a server's live API key (#611). */
export function loadOpenApiServerApiKey(id: string): string | undefined {
  return openapiApiKeyCache.get(id);
}

export interface OpenApiServerConfig {
  id: string;
  name: string;
  /** URL to the openapi.json / openapi.yaml spec */
  specUrl: string;
  /** Base URL for API calls (falls back to servers[0].url in spec) */
  baseUrl?: string;
  /** Optional API key value. */
  apiKey?: string;
  /**
   * True when this server has a stored API key. The value itself lives in the
   * OS keychain (#611), so `apiKey` is only populated from the boot-hydrated
   * in-memory cache by `loadOpenApiServers` — it is never persisted.
   */
  hasApiKey?: boolean;
  /** Header name to send the API key in (default: 'Authorization', value: 'Bearer <apiKey>') */
  apiKeyHeader?: string;
  enabled: boolean;
}

/** Minimal OpenAPI 3.x types we care about */
interface OASpec {
  servers?: { url: string }[];
  paths?: Record<string, Record<string, OAOperation>>;
}
interface OAOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OAParameter[];
  requestBody?: { content?: { 'application/json'?: { schema?: OASchemaObj } } };
}
interface OAParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: { type?: string; enum?: string[] };
}
interface OASchemaObj {
  type?: string;
  properties?: Record<string, { type?: string; description?: string }>;
  required?: string[];
}

// Track which tool names belong to which server for clean unregistration
const _serverToolNames: Map<string, string[]> = new Map();

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/** Convert an OpenAPI operation to a ToolDefinition */
export function operationToToolDefinition(
  serverId: string,
  method: string,
  path: string,
  op: OAOperation,
  baseUrl: string,
  config: Pick<OpenApiServerConfig, 'apiKey' | 'apiKeyHeader'>
): ToolDefinition {
  const opId = op.operationId
    ? sanitize(op.operationId)
    : sanitize(`${method}_${path}`);
  const name = `${sanitize(serverId)}__${opId}`;

  // Merge path + query params into JSON Schema properties
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];

  for (const p of op.parameters ?? []) {
    if (p.in !== 'path' && p.in !== 'query') continue;
    properties[p.name] = {
      type: p.schema?.type ?? 'string',
      description: p.description ?? p.name,
    };
    if (p.required) required.push(p.name);
  }

  // Flatten top-level requestBody properties into tool params
  const bodySchema = op.requestBody?.content?.['application/json']?.schema;
  if (bodySchema?.properties) {
    for (const [k, v] of Object.entries(bodySchema.properties)) {
      properties[k] = { type: v.type ?? 'string', description: v.description ?? k };
    }
    if (bodySchema.required) required.push(...bodySchema.required);
  }

  const execute = async (params: Record<string, any>): Promise<any> => {
    // Substitute path params
    let url = `${baseUrl.replace(/\/$/, '')}${path}`;
    for (const p of op.parameters ?? []) {
      if (p.in === 'path' && params[p.name] !== undefined) {
        url = url.replace(`{${p.name}}`, encodeURIComponent(String(params[p.name])));
      }
    }

    // Build query string
    const queryParts: string[] = [];
    for (const p of op.parameters ?? []) {
      if (p.in === 'query' && params[p.name] !== undefined) {
        queryParts.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(String(params[p.name]))}`);
      }
    }
    if (queryParts.length) url += `?${queryParts.join('&')}`;

    // Build body
    let body: string | undefined;
    if (bodySchema?.properties) {
      const bodyObj: Record<string, any> = {};
      for (const k of Object.keys(bodySchema.properties)) {
        if (params[k] !== undefined) bodyObj[k] = params[k];
      }
      if (Object.keys(bodyObj).length) body = JSON.stringify(bodyObj);
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      const headerName = config.apiKeyHeader ?? 'Authorization';
      const headerValue = headerName === 'Authorization' ? `Bearer ${config.apiKey}` : config.apiKey;
      headers[headerName] = headerValue;
    }

    // Route through Rust to avoid CORS. Only fall back to fetch when Tauri
    // is genuinely unavailable (ImportError / invoke not found) — HTTP errors
    // from Rust must propagate as-is, not be swallowed by the catch.
    let tauriAvailable = false;
    let invokeResult: { success: boolean; status: number; body: string } | null = null;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeResult = await invoke('mcp_http_request', {
        request: { method: method.toUpperCase(), url, headers, body },
      }) as { success: boolean; status: number; body: string };
      tauriAvailable = true;
    } catch (e: any) {
      /* fall through to fetch fallback */
    }

    if (tauriAvailable && invokeResult) {
      if (!invokeResult.success) throw new Error(`HTTP ${invokeResult.status}: ${invokeResult.body}`);
      try { return JSON.parse(invokeResult.body); } catch { return invokeResult.body; }
    }

    // Tauri unavailable — fallback to fetch (browser dev mode)
    const opts: RequestInit = { method: method.toUpperCase(), headers };
    if (body) opts.body = body;
    const r = await fetch(url, opts);
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
    try { return JSON.parse(text); } catch { return text; }
  };

  return {
    name,
    description: op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`,
    // GET/HEAD operations fetch data without side effects (#477); everything
    // else (POST/PUT/PATCH/DELETE) may mutate remote state.
    readOnly: method === 'get' || method === 'head',
    // GET/HEAD are read-only and independent, so they can run concurrently
    // with other parallel-safe tools (#587); mutating verbs stay sequential.
    parallelSafe: method === 'get' || method === 'head',
    parameters: {
      type: 'object',
      properties,
      required: required.length ? required : undefined,
    } as any,
    execute,
  };
}

/** Parse an OpenAPI spec object into ToolDefinitions */
export function specToToolDefinitions(
  serverId: string,
  spec: OASpec,
  config: Pick<OpenApiServerConfig, 'apiKey' | 'apiKeyHeader' | 'baseUrl'>
): ToolDefinition[] {
  const baseUrl = config.baseUrl ?? spec.servers?.[0]?.url ?? '';
  const tools: ToolDefinition[] = [];
  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = (pathItem as any)[method] as OAOperation | undefined;
      if (!op) continue;
      tools.push(operationToToolDefinition(serverId, method, path, op, baseUrl, config));
    }
  }
  return tools;
}

/** Fetch an OpenAPI spec from a URL (via Rust HTTP to avoid CORS) */
export async function fetchOpenApiSpec(url: string, apiKey?: string, apiKeyHeader?: string): Promise<OASpec> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    const h = apiKeyHeader ?? 'Authorization';
    headers[h] = h === 'Authorization' ? `Bearer ${apiKey}` : apiKey;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const res = await invoke('mcp_http_request', {
      request: { method: 'GET', url, headers },
    }) as { success: boolean; status: number; body: string };
    if (!res.success) throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`);
    try { return JSON.parse(res.body) as OASpec; }
    catch { throw new Error(`OpenAPI spec at ${url} returned non-JSON response: ${res.body.slice(0, 200)}`); }
  } catch {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    try { return await res.json() as OASpec; }
    catch { throw new Error(`OpenAPI spec at ${url} returned non-JSON response`); }
  }
}

/** Register all tools from a server config (fetches spec, registers into toolRegistry) */
export async function registerOpenApiServer(config: OpenApiServerConfig): Promise<void> {
  // Unregister previous tools for this server
  unregisterOpenApiServer(config.id);
  if (!config.enabled) return;

  const spec = await fetchOpenApiSpec(config.specUrl, config.apiKey, config.apiKeyHeader);
  const tools = specToToolDefinitions(config.id, spec, config);
  const names: string[] = [];
  for (const tool of tools) {
    toolRegistry.registerTool(tool);
    names.push(tool.name);
  }
  _serverToolNames.set(config.id, names);
}

/** Unregister all tools belonging to a server */
export function unregisterOpenApiServer(id: string): void {
  const names = _serverToolNames.get(id) ?? [];
  for (const name of names) toolRegistry.unregisterTool(name);
  _serverToolNames.delete(id);
}

// ── Persistence ──────────────────────────────────────────────────────────────

export function loadOpenApiServers(): OpenApiServerConfig[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    const arr = Array.isArray(raw) ? raw : [];
    return arr.map(s => ({ ...s, apiKey: loadOpenApiServerApiKey(s.id) ?? undefined })) as OpenApiServerConfig[];
  } catch { return []; }
}

/**
 * Persist server arrays. Each server's key is written to the keychain (+ cache)
 * when present, or purged when absent, so the cache never serves a stale token
 * once the key is removed (#611).
 */
export async function saveOpenApiServers(configs: OpenApiServerConfig[]): Promise<void> {
  for (const config of configs) {
    if (config.apiKey) {
      await secretStore.set(openapiSecretKey(config.id), config.apiKey);
      openapiApiKeyCache.set(config.id, config.apiKey);
    } else {
      await secretStore.delete(openapiSecretKey(config.id));
      openapiApiKeyCache.delete(config.id);
    }
  }
  persistOpenApiServers(configs.map(toPersistedServer));
}

/**
 * Add a server. The entry is returned with its `apiKey` in place so the caller
 * can use it immediately; `registerOpenApiServer` reads the key from the cache.
 */
export async function addOpenApiServer(config: Omit<OpenApiServerConfig, 'id'>): Promise<OpenApiServerConfig> {
  const entry: OpenApiServerConfig = { ...config, id: crypto.randomUUID() };
  const all = loadOpenApiServers();
  all.push(entry);
  await saveOpenApiServers(all);
  return entry;
}

/**
 * Update a server in place. The API key is preserved from the cache unless the
 * patch supplies one, so name/URL edits never drop a stored key.
 */
export async function updateOpenApiServer(id: string, patch: Partial<Omit<OpenApiServerConfig, 'id'>>): Promise<void> {
  const prev = loadOpenApiServers().find(s => s.id === id);
  await saveOpenApiServers(loadOpenApiServers().map(s => s.id === id ? { ...s, ...patch, apiKey: patch.apiKey ?? prev?.apiKey } : s));
}

/**
 * Remove a server and purge its API key from the keychain + cache (#611).
 */
export async function removeOpenApiServer(id: string): Promise<void> {
  await secretStore.delete(openapiSecretKey(id));
  openapiApiKeyCache.delete(id);
  await saveOpenApiServers(loadOpenApiServers().filter(s => s.id !== id));
}

/**
 * Migrate plaintext OpenAPI keys from a pre-#611 install into the keychain
 * (#611 step 3). Any record that still carries a plaintext `apiKey` is written
 * to the keychain + cache, then its `apiKey` is stripped and replaced with the
 * `hasApiKey` presence flag so the key is never read from localStorage again.
 */
export async function migrateOpenApiKeys(): Promise<void> {
  let dirty = false;
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    const arr = Array.isArray(raw) ? raw : [];
    const migrated: Omit<OpenApiServerConfig, 'apiKey'>[] = [];
    for (const s of arr) {
      if (s && typeof s.apiKey === 'string' && s.apiKey) {
        await secretStore.set(openapiSecretKey(s.id), s.apiKey);
        openapiApiKeyCache.set(s.id, s.apiKey);
        dirty = true;
        const { apiKey, ...rest } = s;
        migrated.push({ ...rest, hasApiKey: true });
      } else {
        migrated.push(s as Omit<OpenApiServerConfig, 'apiKey'>);
      }
    }
    if (dirty) persistOpenApiServers(migrated);
  } catch { /* ignore malformed storage during migration */ }
}

/**
 * Hydrate the in-memory key cache from the keychain (#611 step 2). Reads one
 * key per stored server at boot; the sync accessors then serve from the cache.
 */
export async function initOpenApiServersSecrets(): Promise<void> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    const arr = Array.isArray(raw) ? raw : [];
    await Promise.all(arr.map(async (s: any) => {
      if (s && s.id) {
        const v = await secretStore.get(openapiSecretKey(s.id));
        if (v != null) openapiApiKeyCache.set(s.id, v);
      }
    }));
  } catch { /* ignore malformed storage */ }
}

/** Re-register all enabled servers (called on app startup) */
export async function initOpenApiServers(): Promise<void> {
  const configs = loadOpenApiServers().filter(s => s.enabled);
  await Promise.allSettled(configs.map(c => registerOpenApiServer(c)));
}
