/**
 * Model connections (#123): register OpenAI-compatible / LM Studio endpoints
 * alongside the default Ollama server. Each connection exposes a model list;
 * all enabled connections are aggregated into one unified model selector.
 *
 * ## Configuration
 *
 * Connections can be configured in two ways:
 * 1. **Project config.json** - At project root for persistent provider definitions
 * 2. **localStorage** - Runtime connection state (user-added or edited connections)
 *
 * Each connection has:
 *   - id: unique identifier (UUID)
 *   - name: display name for the connection
 *   - kind: 'openai' (OpenAI-compatible APIs like LM Studio) or 'ollama'
 *   - baseUrl: base URL of the server (e.g., http://localhost:1234 for LM Studio)
 *   - apiKey: optional API key for authenticated endpoints
 *   - enabled: whether this connection is active
 *
 * ## Provider Types
 *
 * | Type | Description |
 * |------|-------------|
 * | `ollama` | Local Ollama server at `/api/tags`, `/api/chat` |
 * | `openai` / `lmstudio` | OpenAI-compatible APIs (`/v1/models`, `/v1/chat/completions`) |
 *
 * ## LM Studio Configuration
 *
 * To connect to LM Studio:
 * 1. Start LM Studio on your target machine (e.g., http://gx10:1234)
 * 2. Load a model in LM Studio (e.g., qwen/qwen3-coder-next)
 * 3. The connection will be automatically detected when the app fetches models
 *
 * ## Config File Format (config.json)
 *
 * Create or edit `config.json` at your project root:
 * ```json
 * {
 *   "version": 1,
 *   "providers": [
 *     {
 *       "id": "local-ollama",
 *       "name": "Local Ollama",
 *       "type": "ollama",
 *       "baseUrl": "http://localhost:11434",
 *       "enabled": true
 *     },
 *     {
 *       "id": "lm-studio",
 *       "name": "LM Studio (gx10)",
 *       "type": "lmstudio",
 *       "baseUrl": "http://gx10:1234",
 *       "enabled": true,
 *       "defaultModel": "qwen/qwen3-coder-next"
 *     }
 *   ]
 * }
 * ```
 *
 * ## Default Connections
 *
 * The app automatically creates these default connections on first launch:
 * - Local Ollama: http://localhost:11434 (auto-detected)
 * - LM Studio: http://gx10:1234 (if configured in config.json or environment)
 */
import { uuid } from './uuid';
import { makeQwenStreamFilter } from './qwenDialect';

const STORAGE_KEY = 'model_connections';

export type ConnectionKind = 'openai' | 'ollama';

export interface ModelConnection {
  id: string;
  name: string;
  kind: ConnectionKind;
  /** Base URL — e.g. http://localhost:1234 */
  baseUrl: string;
  /** Optional API key for OpenAI-compatible endpoints */
  apiKey?: string;
  enabled: boolean;
  /** Optional provider-declared default model tag (e.g. "north-mini-code-1.0:q8_0") */
  defaultModel?: string;
}

/** A model entry tagged with which connection it came from */
export interface ConnectedModel {
  id: string;           // "<connectionId>/<modelName>"
  name: string;         // display name (model tag)
  connectionId: string;
  connectionName: string;
  kind: ConnectionKind;
  /** Raw size bytes when available (Ollama /api/tags) */
  size?: number;
  quantization?: string;
  parameterSize?: string;
  /** True for cloud-flagged models */
  cloud?: boolean;
}

// ── Default connections ─────────────────────────────────────────────────────

/** Get default connections (Ollama + LM Studio) for first-time setup */
export function getDefaultConnections(): ModelConnection[] {
  const defaults: ModelConnection[] = [];

  // Always include local Ollama as the default
  defaults.push({
    id: 'local-ollama',
    name: 'Local Ollama',
    kind: 'ollama',
    baseUrl: 'http://localhost:11434',
    enabled: true,
  });

  // LM Studio at gx10:1234 (as requested in the task)
  const lmStudioUrl = typeof process !== 'undefined' && process.env && process.env.LM_STUDIO_URL
    ? process.env.LM_STUDIO_URL
    : 'http://gx10:1234';
  
  defaults.push({
    id: 'lm-studio',
    name: 'LM Studio (gx10)',
    kind: 'openai', // LM Studio uses OpenAI-compatible API
    baseUrl: lmStudioUrl,
    enabled: true,
  });

  return defaults;
}

// ── Persistence ───────────────────────────────────────────────────────────────

export function loadConnections(): ModelConnection[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    // First-time launch: initialize with defaults
    const defaults = getDefaultConnections();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults)); } catch { /* quota */ }
    return defaults;
  }
  
  let parsed: ModelConnection[];
  try { parsed = JSON.parse(stored); } catch { parsed = []; }
  
  // Add missing default connections (in case of app updates)
  const storedIds = new Set(parsed.map(c => c.id));
  for (const def of getDefaultConnections()) {
    if (!storedIds.has(def.id)) {
      parsed.push(def);
    }
  }
  
  return parsed;
}

export function saveConnections(conns: ModelConnection[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(conns)); } catch { /* quota */ }
}

/**
 * Merge project-config.json providers (from #553) with localStorage-backed
 * connections. `connections` is the source of truth for runtime edits
 * (user-added / enabled-flagged connections persisted to localStorage);
 * `configJsonConns` are the persistent provider definitions from config.json.
 *
 * A config.json provider wins when:
 *   - it does not already exist in `connections`, or
 *   - it exists in `connections` but is disabled (config.json re-enables it),
 *     and the localStorage copy is the built-in default.
 *
 * This keeps config.json authoritative for provider definitions while leaving
 * localStorage edits in force, so toggling a provider back on in config.json
 * actually re-enables it (#553).
 */
export function mergeConfigWithConnections(
  connections: ModelConnection[],
  configJsonConns: ModelConnection[]
): ModelConnection[] {
  if (!configJsonConns.length) return connections;

  const merged = connections.slice();
  const seen = new Set(merged.map(c => c.id));

  for (const provider of configJsonConns) {
    const existing = merged.find(c => c.id === provider.id);
    if (existing) {
      if (existing.enabled) {
        // Carry the config-declared default model onto the enabled storage
        // copy. Storage connections never ship a `defaultModel`, so a
        // config.json value always wins here (authoritative for boot model).
        existing.defaultModel = provider.defaultModel;
        continue;
      }
      // A disabled built-in default from config.json re-enables itself.
      if (isBuiltinDefault(existing)) {
        const idx = merged.findIndex(c => c.id === provider.id);
        merged[idx] = provider;
      }
      continue;
    }
    if (!seen.has(provider.id)) {
      merged.push(provider);
      seen.add(provider.id);
    }
  }
  return merged;
}

/** Built-in defaults created on first launch (local-ollama, lm-studio). */
function isBuiltinDefault(conn: ModelConnection): boolean {
  return conn.id === 'local-ollama' || conn.id === 'lm-studio';
}

export function addConnection(conn: Omit<ModelConnection, 'id'>): ModelConnection {
  const entry: ModelConnection = { ...conn, id: uuid() };
  const all = loadConnections();
  all.push(entry);
  saveConnections(all);
  return entry;
}

export function updateConnection(id: string, patch: Partial<Omit<ModelConnection, 'id'>>): void {
  saveConnections(loadConnections().map(c => c.id === id ? { ...c, ...patch } : c));
}

export function removeConnection(id: string): void {
  saveConnections(loadConnections().filter(c => c.id !== id));
}

// ── Model fetching ────────────────────────────────────────────────────────────

/**
 * Fetch models from an OpenAI-compatible /v1/models endpoint.
 * Returns an empty array on any error (connection may be offline).
 */
export async function fetchOpenAiModels(conn: ModelConnection): Promise<ConnectedModel[]> {
  try {
    const headers: Record<string, string> = {};
    if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`;
    const res = await fetch(`${conn.baseUrl.replace(/\/$/, '')}/v1/models`, { headers });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { id: string }[] };
    return (data.data ?? []).map(m => ({
      id: `${conn.id}/${m.id}`,
      name: m.id,
      connectionId: conn.id,
      connectionName: conn.name,
      kind: conn.kind,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch models from an Ollama /api/tags endpoint.
 * Returns an empty array on any error.
 */
export async function fetchOllamaConnectionModels(conn: ModelConnection): Promise<ConnectedModel[]> {
  try {
    // Authenticated remotes — including ollama.com itself — reject an
    // unauthenticated /api/tags with 401, which used to surface as an
    // unexplained empty model list (#493).
    const headers: Record<string, string> = {};
    if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`;
    const res = await fetch(`${conn.baseUrl.replace(/\/$/, '')}/api/tags`, { headers });
    if (!res.ok) {
      console.warn(
        `[connections] ${conn.name}: /api/tags returned ${res.status}` +
        (res.status === 401 || res.status === 403
          ? ' — this server needs an API token (set one on the connection).'
          : ''),
      );
      return [];
    }
    const data = await res.json() as { models?: any[] };
    return (data.models ?? []).map((m: any) => ({
      id: `${conn.id}/${m.name}`,
      name: m.name,
      connectionId: conn.id,
      connectionName: conn.name,
      kind: 'ollama',
      size: typeof m.size === 'number' ? m.size : undefined,
      quantization: m.details?.quantization_level,
      parameterSize: m.details?.parameter_size,
    }));
  } catch {
    return [];
  }
}

// ── Connection health status (#553 / GAP-G5) ─────────────────────────────────
/**
 * Connection health states surfaced by `checkConnectionHealth` (#553 / G5).
 *
 * - healthy:   the provider responded to the live probe (models fetched or,
 *              for an Ollama server, the HTTP endpoint answered).
 * - unreachable: the server did not answer — network/DNS/timeout, or the
 *                endpoint returned a non-OK HTTP status.
 * - authError: the provider answered but rejected the request with an
 *              authentication error (HTTP 401/403). For Ollama this means the
 *              configured apiKey token was rejected; for OpenAI-compatible
 *              providers it means an invalid/missing key.
 */
export type ConnectionHealthStatus = 'healthy' | 'unreachable' | 'authError';

/** A single-provider health check result. */
export interface ConnectionHealth {
  connectionId: string;
  status: ConnectionHealthStatus;
  /** Human-readable detail (HTTP status text, fetch message, etc.). */
  detail?: string;
}

/**
 * Check a single connection's health against its live endpoint.
 *
 * Probes the connection's canonical "list models" endpoint — /api/tags for
 * Ollama, /v1/models for OpenAI-compatible providers — reusing the same auth
 * headers the model fetch already sends, so the status reflects exactly what a
 * real model request would experience (#553 / G5).
 *
 * Classification:
 * - HTTP 401/403 -> authError
 * - other non-OK / fetch throw (offline, DNS, timeout) -> unreachable
 * - HTTP 200 -> healthy
 */
export async function checkConnectionHealth(conn: ModelConnection): Promise<ConnectionHealth> {
  const base = conn.baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {};
  if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`;

  try {
    const endpoint = conn.kind === 'openai'
      ? `${base}/v1/models`
      : `${base}/api/tags`;
    const res = await fetch(endpoint, { headers });

    if (res.status === 401 || res.status === 403) {
      return {
        connectionId: conn.id,
        status: 'authError',
        detail: `${conn.name} requires authentication (HTTP ${res.status}). Check the API key.`,
      };
    }

    if (!res.ok) {
      return {
        connectionId: conn.id,
        status: 'unreachable',
        detail: `${conn.name} responded with HTTP ${res.status} ${res.statusText}`,
      };
    }

    return { connectionId: conn.id, status: 'healthy' };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      connectionId: conn.id,
      status: 'unreachable',
      detail: `${conn.name} is unreachable (${message})`,
    };
  }
}

// ── Model selector grouping (#554) ──────────────────────────────────────────

/** A single option rendered inside a provider <optgroup>. */
export interface ModelSelectorOption {
  /** DOM-safe unique key for React; uses "<connectionId>/<name>" for remotes. */
  key: string;
  /** The <option value> — bare model name for local models, "<connId>/<name>" for remotes. */
  value: string;
  /** Display name (the model tag). */
  name: string;
  /** Optional suffix (size / quantization) shown in the option. */
  suffix?: string;
  /** Optional leading marker (e.g. a ⛅ cloud glyph). */
  marker?: string;
}

/** One provider <optgroup> in the model selector. Empty providers are kept so
 *  config.json-declared providers that expose no models still appear in the list. */
export interface ModelSelectorGroup {
  /** The <optgroup label>, e.g. "— Local Ollama —" or "— Remote Ollama: Alpha —". */
  label: string;
  /** Whether to render this group at all. Empty providers render with 0 options. */
  isEmpty?: boolean;
  options: ModelSelectorOption[];
}

/** Build a stable sort key for a model tag: lowercase name, ignoring case. */
export function sortKeyForModel(name: string): string {
  return name.toLowerCase();
}

/**
 * Group enabled connection models by provider for the model selector (#554).
 *
 * Each enabled connection becomes its own <optgroup>. Local Ollama (id
 * `local-ollama`) is relabeled "Local Ollama" so the built-in default is
 * recognisable; other providers are labeled by their display name, with Ollama
 * remotes prefixed "Remote Ollama:". Groups with zero models are still emitted
 * (with `isEmpty: true`) so a config.json provider that is enabled but currently
 * exposes no models does not silently vanish.
 *
 * Options are sorted by model tag so the selector is stable across fetches.
 */
export function buildModelGroups(
  connections: ModelConnection[],
  models: ConnectedModel[],
): ModelSelectorGroup[] {
  const byConn = new Map<string, ConnectedModel[]>();
  for (const m of models) {
    const list = byConn.get(m.connectionId) ?? [];
    list.push(m);
    byConn.set(m.connectionId, list);
  }

  const enabledConnections = connections
    .filter((c) => c.enabled)
    .sort((a, b) => sortKeyForModel(a.name).localeCompare(sortKeyForModel(b.name)));

  const renderLocal = (conn: ModelConnection) => conn.id === 'local-ollama';

  const groups: ModelSelectorGroup[] = enabledConnections.map((conn) => {
    const connModels = (byConn.get(conn.id) ?? []).sort((a, b) =>
      sortKeyForModel(a.name).localeCompare(sortKeyForModel(b.name)),
    );

    const isLocal = renderLocal(conn);
    const label = isLocal
      ? '— Local Ollama —'
      : conn.kind === 'ollama'
        ? `— Remote Ollama: ${conn.name} —`
        : `— ${conn.name} —`;

    const options: ModelSelectorOption[] = connModels.map((m) => ({
      key: m.id,
      value: m.id,
      name: m.name,
      suffix: [m.parameterSize, m.quantization].filter(Boolean).join(' · '),
      marker: m.cloud ? '⛅' : undefined,
    }));

    return { label, isEmpty: options.length === 0, options };
  });

  return groups;
}

/** Fetch models from all enabled connections in parallel */
export async function fetchAllConnectionModels(connections: ModelConnection[]): Promise<ConnectedModel[]> {
  const enabled = connections.filter(c => c.enabled);
  const results = await Promise.allSettled(
    enabled.map(c => c.kind === 'openai' ? fetchOpenAiModels(c) : fetchOllamaConnectionModels(c))
  );
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

// ── LM Studio specific helpers ───────────────────────────────────────────────

/** Test connection to LM Studio and fetch available models */
export async function testLmStudioConnection(conn: ModelConnection): Promise<{ success: boolean; models: ConnectedModel[]; error?: string }> {
  try {
    // LM Studio uses OpenAI-compatible /v1/models endpoint
    const headers: Record<string, string> = {};
    if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`;
    
    const res = await fetch(`${conn.baseUrl.replace(/\/$/, '')}/v1/models`, { headers });
    if (!res.ok) {
      return {
        success: false,
        models: [],
        error: `HTTP ${res.status}: ${res.statusText}`
      };
    }
    
    const data = await res.json() as { data?: { id: string }[] };
    const models = (data.data ?? []).map(m => ({
      id: `${conn.id}/${m.id}`,
      name: m.id,
      connectionId: conn.id,
      connectionName: conn.name,
      kind: conn.kind,
    }));
    
    return {
      success: true,
      models,
      error: undefined
    };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      models: [],
      error: errorMsg
    };
  }
}

/** Get model list from LM Studio without authentication */
export async function getLmStudioModels(baseUrl: string = 'http://localhost:1234'): Promise<ConnectedModel[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/models`);
    if (!res.ok) return [];
    
    const data = await res.json() as { data?: { id: string }[] };
    return (data.data ?? []).map(m => ({
      id: `lm-studio-temp/${m.id}`,
      name: m.id,
      connectionId: 'lm-studio-temp',
      connectionName: 'LM Studio',
      kind: 'openai' as const,
    }));
  } catch {
    return [];
  }
}

// ── Stream chat through the right connection ───────────────────────────────────

/**
 * Build a descriptive Error from a non-ok OpenAI-compatible response (#458).
 * OpenAI-compatible endpoints (OpenAI, LM Studio, vLLM, etc.) return the
 * failure reason as JSON in the body:
 *   `{"error": {"message": "Invalid API key provided", ...}}`
 * Some simpler proxies use the Ollama-style `{"error": "message string"}`.
 * Without reading the body the caller only sees a generic HTTP statusText
 * ("Unauthorized", "Not Found") which hides the actionable detail. Falls back
 * to `statusText` when the body is absent, non-JSON, or has no error field.
 */
export async function openAiErrorFromResponse(res: Response, prefix: string): Promise<Error> {
  let detail = res.statusText;
  try {
    const body = await res.json();
    if (body?.error) {
      // OpenAI format: { error: { message: "..." } }
      if (typeof body.error === 'string' && body.error.trim()) {
        detail = body.error.trim();
      } else if (typeof body.error.message === 'string' && body.error.message.trim()) {
        detail = body.error.message.trim();
      }
    }
    // Some endpoints use { message: "..." } or { detail: "..." } at top level
    if (detail === res.statusText) {
      if (typeof body?.message === 'string' && body.message.trim()) {
        detail = body.message.trim();
      } else if (typeof body?.detail === 'string' && body.detail.trim()) {
        detail = body.detail.trim();
      }
    }
  } catch {
    // Body is not JSON or cannot be consumed — keep statusText.
  }
  return new Error(`${prefix}: ${detail}`);
}

/**
 * Build chat-stream request options for an OpenAI-compatible endpoint.
 * Returns { url, headers, body } ready for fetch().
 */
export function buildOpenAiChatRequest(
  conn: ModelConnection,
  model: string,
  messages: { role: string; content: string }[],
  options?: { temperature?: number; max_tokens?: number },
  stream = true
): { url: string; headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`;
  return {
    url: `${conn.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
    headers,
    body: JSON.stringify({ model, messages, stream, ...options }),
  };
}

/**
 * Parse a Server-Sent Events (SSE) stream from an OpenAI-compatible endpoint.
 * Calls onChunk for each content delta. Resolves when stream ends.
 */
export async function streamOpenAiChat(
  conn: ModelConnection,
  model: string,
  messages: { role: string; content: string }[],
  onChunk: (delta: string, reasoning?: string) => void,
  options?: { temperature?: number },
  signal?: AbortSignal
): Promise<void> {
  const { url, headers, body } = buildOpenAiChatRequest(conn, model, messages, options);
  const res = await fetch(url, { method: 'POST', headers, body, signal });
  if (!res.ok) throw await openAiErrorFromResponse(res, 'OpenAI stream error');

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error('Response body is null');

  // Qwen builds served by LM Studio / llama.cpp put their reasoning inline as
  // <think>…</think> in `content` instead of in `reasoning_content` (#551).
  // Without this split the chat bubble shows the model's scratchpad as if it
  // were the answer. The filter is chunk-boundary safe, so a tag straddling
  // two SSE frames still lands on the right channel.
  // captureToolCalls stays OFF here: plain chat has no tool loop to consume a
  // withheld tool-call channel, so diverting those spans would delete them
  // from the reply — a model *explaining* the <tool_call> format would have
  // its example vanish mid-sentence. Only <think> is split.
  const filter = makeQwenStreamFilter({ captureToolCalls: false });
  const emit = (raw: string) => {
    const { content, reasoning } = filter.push(raw);
    if (reasoning) onChunk('', reasoning);
    if (content) onChunk(content);
  };
  // Release text the filter withheld while it waited to see whether a
  // trailing "<thi…" would become a real tag; without this, a reply ending in
  // an angle bracket loses its last characters.
  const flush = () => {
    const { content, reasoning } = filter.flush();
    if (reasoning) onChunk('', reasoning);
    if (content) onChunk(content);
  };

  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { flush(); return; }
      try {
        const chunk = JSON.parse(data);
        const d = chunk?.choices?.[0]?.delta;
        const reasoning = d?.reasoning_content ?? d?.thinking ?? '';
        if (reasoning) onChunk('', reasoning);
        if (d?.content) emit(d.content);
      } catch {
        // malformed SSE line — skip
      }
    }
  }
  // Flush any remaining buffered content after the stream ends (#466).
  if (buf.trim()) {
    const line = buf.trim();
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      if (data === '[DONE]') { flush(); return; }
      try {
        const chunk = JSON.parse(data);
        const d = chunk?.choices?.[0]?.delta;
        const reasoning = d?.reasoning_content ?? d?.thinking ?? '';
        if (reasoning) onChunk('', reasoning);
        if (d?.content) emit(d.content);
      } catch {
        // malformed trailing SSE line — skip
      }
    }
  }
  flush();
}
