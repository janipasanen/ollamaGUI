/**
 * Model connections (#123): register OpenAI-compatible / LM Studio endpoints
 * alongside the default Ollama server. Each connection exposes a model list;
 * all enabled connections are aggregated into one unified model selector.
 */
import { makeQwenStreamFilter } from './qwenDialect';
import type { GenerationOptions } from './ollama';

const STORAGE_KEY = 'model_connections';

/**
 * 'vllm' is served by the same OpenAI chat-completions dialect as 'openai';
 * it is a separate kind so the UI can label it, default its port, and so
 * vLLM-only wire quirks stay documented where they are handled rather than
 * hidden behind a generic "OpenAI-compatible" label.
 */
export type ConnectionKind = 'openai' | 'ollama' | 'vllm';

/** Kinds that speak the OpenAI /v1 dialect (model list, chat, agent loop). */
export const OPENAI_COMPATIBLE_KINDS: ConnectionKind[] = ['openai', 'vllm'];

/**
 * True when a connection speaks OpenAI /v1 rather than Ollama's /api.
 * Every routing decision must go through this rather than `=== 'openai'`,
 * or a new kind silently falls through to the Ollama branch.
 */
export function isOpenAiCompatible(kind: ConnectionKind | undefined): boolean {
  return kind === 'openai' || kind === 'vllm';
}

/** Conventional port per provider, used to complete a host-only base URL. */
export const DEFAULT_PORTS: Record<ConnectionKind, number> = {
  openai: 1234,  // LM Studio
  vllm: 8000,    // vLLM's `--port` default
  ollama: 11434,
};

/**
 * Normalise what a user typed into a base URL we can call.
 *
 * People paste bare hosts ("gx10", "gx10:8000") far more often than full
 * URLs, and a bare host makes every request fail with an opaque network
 * error. So: a bare host gets the scheme and the provider's conventional
 * port; a URL the user wrote the scheme for is taken exactly as given,
 * because that is how they express an endpoint on port 80 behind a proxy.
 * A trailing "/v1" is dropped for OpenAI-dialect providers, whose callers
 * append their own.
 */
export function normalizeBaseUrl(input: string, kind: ConnectionKind): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!url) return url;
  const hadScheme = /^https?:\/\//i.test(url);
  if (!hadScheme) url = `http://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  // Complete the port ONLY for a bare host. Writing the scheme is how a user
  // says "this is the whole URL", and we must take them at their word: a
  // server behind nginx/Caddy/a tunnel is reached at "http://ai.example.com",
  // and forcing :11434 or :8000 onto it made that endpoint unreachable — with
  // no way to ask for port 80, since `parsed.port` reads '' for a scheme's
  // default port and so cannot tell "no port" from an explicit ":80".
  // IPv6 is safe here: "[::1]" ends in ']', while "[::1]:8000" ends in a port.
  const authority = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
  const typedPort = /:\d+$/.test(authority);
  if (!hadScheme && !typedPort) {
    parsed.port = String(DEFAULT_PORTS[kind]);
  }

  // Drop a trailing "/v1": every OpenAI-dialect call site appends its own, and
  // vLLM's and LM Studio's own docs print the endpoint WITH it — so pasting
  // the documented URL produced /v1/v1/models and a 404 that surfaced only as
  // "could not fetch models". A deeper prefix (a reverse-proxy mount) is kept.
  if (isOpenAiCompatible(kind)) {
    parsed.pathname = parsed.pathname.replace(/\/v1\/?$/, '');
  }

  return parsed.toString().replace(/\/+$/, '');
}

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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(conns)); } catch { /* quota */ }
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

/** Fetch models from all enabled connections in parallel */
export async function fetchAllConnectionModels(connections: ModelConnection[]): Promise<ConnectedModel[]> {
  const enabled = connections.filter(c => c.enabled);
  const results = await Promise.allSettled(
    enabled.map(c => isOpenAiCompatible(c.kind) ? fetchOpenAiModels(c) : fetchOllamaConnectionModels(c))
  );
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
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
 * Translate our Ollama-shaped generation options into OpenAI sampling
 * parameters (#568).
 *
 * Only defined keys are emitted, because several servers reject a null or an
 * empty value they would otherwise have defaulted. Specifically:
 *  - `num_predict` is Ollama's name for `max_tokens`, and -1 is its
 *    "unlimited" sentinel — a value OpenAI has no spelling for, so it is
 *    dropped rather than sent as a literal -1.
 *  - an EMPTY `stop` array is dropped: `/stop clear` leaves `stop: []`, which
 *    survives cleanGenerationOptions (it only strips undefined/null/NaN), and
 *    posting `stop: []` makes some servers 400.
 *  - `num_ctx` is never forwarded. It has no chat-completions equivalent; in
 *    this app it is the client-side budget that drives compaction and the
 *    context meter, so it stays meaningful without being sent.
 *  - `top_k` is NOT an OpenAI parameter. llama.cpp, LM Studio and vLLM accept
 *    it, but a strict gateway answers 400 "Unrecognized request argument", and
 *    nothing stops an `openai` connection pointing at one. It is sent only
 *    where it is known-safe: vLLM, or a keyless (i.e. local) endpoint.
 */
export function toOpenAiSampling(
  o: GenerationOptions | undefined,
  conn?: Pick<ModelConnection, 'kind' | 'apiKey'>,
): Record<string, unknown> {
  if (!o) return {};
  const out: Record<string, unknown> = {};
  if (typeof o.temperature === 'number') out.temperature = o.temperature;
  if (typeof o.top_p === 'number') out.top_p = o.top_p;
  if (typeof o.num_predict === 'number' && o.num_predict !== -1) out.max_tokens = o.num_predict;
  if (Array.isArray(o.stop) && o.stop.length > 0) out.stop = o.stop;
  const topKIsSafe = conn ? (conn.kind === 'vllm' || !conn.apiKey) : false;
  if (typeof o.top_k === 'number' && topKIsSafe) out.top_k = o.top_k;
  return out;
}

/**
 * Build chat-stream request options for an OpenAI-compatible endpoint.
 * Returns { url, headers, body } ready for fetch().
 */
export function buildOpenAiChatRequest(
  conn: ModelConnection,
  model: string,
  messages: { role: string; content: string }[],
  options?: GenerationOptions,
  stream = true
): { url: string; headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`;
  return {
    url: `${conn.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
    headers,
    // Sampling parameters are mapped, not spread: our options are Ollama-shaped
    // and several of them need renaming or dropping (#568).
    body: JSON.stringify({ model, messages, stream, ...toOpenAiSampling(options, conn) }),
  };
}

/**
 * Reasoning text carried by a streamed delta, whichever field the server uses.
 *
 * There is no agreed field name: LM Studio and most proxies use
 * `reasoning_content`, some use `thinking`, and vLLM (0.28, verified against a
 * live server) streams `reasoning`. Reading only the first two made a vLLM
 * reasoning model look completely silent — every token went to a field we
 * never read, so the bubble stayed empty until the final answer arrived.
 */
export function deltaReasoning(d: any): string {
  return d?.reasoning_content ?? d?.thinking ?? d?.reasoning ?? '';
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
  options?: GenerationOptions,
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
        const reasoning = deltaReasoning(d);
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
        const reasoning = deltaReasoning(d);
        if (reasoning) onChunk('', reasoning);
        if (d?.content) emit(d.content);
      } catch {
        // malformed trailing SSE line — skip
      }
    }
  }
  flush();
}
