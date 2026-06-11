/**
 * Model connections (#123): register OpenAI-compatible / LM Studio endpoints
 * alongside the default Ollama server. Each connection exposes a model list;
 * all enabled connections are aggregated into one unified model selector.
 */
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

// ── Persistence ───────────────────────────────────────────────────────────────

export function loadConnections(): ModelConnection[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}

export function saveConnections(conns: ModelConnection[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conns));
}

export function addConnection(conn: Omit<ModelConnection, 'id'>): ModelConnection {
  const entry: ModelConnection = { ...conn, id: crypto.randomUUID() };
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
    const res = await fetch(`${conn.baseUrl.replace(/\/$/, '')}/api/tags`);
    if (!res.ok) return [];
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

/** Fetch models from all enabled connections in parallel */
export async function fetchAllConnectionModels(connections: ModelConnection[]): Promise<ConnectedModel[]> {
  const enabled = connections.filter(c => c.enabled);
  const results = await Promise.allSettled(
    enabled.map(c => c.kind === 'openai' ? fetchOpenAiModels(c) : fetchOllamaConnectionModels(c))
  );
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

// ── Stream chat through the right connection ───────────────────────────────────

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
  onChunk: (delta: string) => void,
  options?: { temperature?: number },
  signal?: AbortSignal
): Promise<void> {
  const { url, headers, body } = buildOpenAiChatRequest(conn, model, messages, options);
  const res = await fetch(url, { method: 'POST', headers, body, signal });
  if (!res.ok) throw new Error(`OpenAI stream error: ${res.statusText}`);

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error('Response body is null');

  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk?.choices?.[0]?.delta?.content ?? '';
        if (delta) onChunk(delta);
      } catch {
        // malformed SSE line — skip
      }
    }
  }
}
