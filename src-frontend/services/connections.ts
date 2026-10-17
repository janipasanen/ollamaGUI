/**
 * Model connections (#123): register OpenAI-compatible / LM Studio endpoints
 * alongside the default Ollama server. Each connection exposes a model list;
 * all enabled connections are aggregated into one unified model selector.
 */
import { formatErrorLine } from './errorMessages';
import { type Message, GenerationOptions, translateOpenAiSamplingOptions, openAiResponseFormat, type StructuredOutputFormat, usageToGenStats, type GenStats } from './ollama';

const STORAGE_KEY = 'model_connections';

/**
 * A single tool call in a transcript, as seen inside a persisted assistant
 * `tool_calls` array. OpenAI-dialect calls shape it as `{ id, type, function:
 * { name, arguments } }`; Ollama-dialect calls drop the `function` wrapper and
 * store `name`/`arguments` at the top level.
 */
interface RawToolCall {
  id?: string;
  name?: string;
  function?: { name?: string; arguments?: unknown };
  arguments?: unknown;
}

/** A single accumulated tool call, normalized to an id + name + string args. */
interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

/** The waiting assistant tool_calls turn plus its (unanswered) accumulated calls. */
interface PendingTurn {
  content: string;
  calls: PendingToolCall[];
}

/**
 * Normalize an internal `Message[]` transcript into valid OpenAI-compatible
 * chat history so it can be replayed to a strict `/v1/chat/completions` server
 * (#579).
 *
 * Two structural defects otherwise make the first follow-up turn 400 on vLLM
 * and recent LM Studio:
 *  - the tool message's `tool_call_id` is fabricated from the tool name (or
 *    omitted), so it matches no preceding `tool_calls[].id`;
 *  - multi-call turns can arrive as `assistant(tc1), assistant(tc2),
 *    tool(r1), tool(r2)` (each assistant turn not immediately followed by its
 *    responses), or carry object-valued `function.arguments`.
 *
 * Normalization coalesces consecutive assistant tool_calls turns, matches each
 * tool message to the nearest preceding unanswered tool call (by explicit
 * `tool_call_id`, falling back to name for legacy sessions), drops tool
 * messages that match nothing, drops an assistant tool_calls turn left with
 * zero responses (or keeps its text as plain assistant text), and
 * JSON-stringifies object-valued `function.arguments`.
 */
export function normalizeOpenAiHistory(messages: Message[]): any[] {
  const out: any[] = [];

  // The current waiting assistant tool_calls turn, plus the tool messages seen
  // immediately after it. A tool message is only emitted after the assistant
  // turn it answers, so we buffer the turn until a non-tool message (or the
  // end) forces it to flush.
  let pendingAssistant: PendingTurn | null = null;
  let pendingTools: Message[] = [];

  const flush = () => {
    if (!pendingAssistant && pendingTools.length === 0) return;

    const pairs: { call: PendingToolCall; result: Message }[] = [];
    if (pendingAssistant) {
      let toolIndex = 0;
      for (const call of pendingAssistant?.calls ?? []) {
        // Find the next still-unseen tool message that answers this call.
        let result: Message | undefined;
        while (toolIndex < pendingTools.length) {
          const candidate = pendingTools[toolIndex++];
          if (answersCall(call, candidate)) {
            result = candidate;
            break;
          }
        }
        if (result) pairs.push({ call, result });
      }
    }

    const text = (pendingAssistant && pendingAssistant.content) || '';
    if (pairs.length === 0) {
      // No tool response answers this turn. An orphaned assistant tool_calls
      // turn is invalid history, so drop it — but keep the human-facing text
      // (e.g. "Calling tool: …") as a plain assistant message.
      const trimmed = text.trim();
      if (trimmed) out.push({ role: 'assistant', content: trimmed });
    } else {
      const assistantMsg: any = { role: 'assistant' };
      if (text.trim()) assistantMsg.content = text;
      assistantMsg.tool_calls = pairs.map(({ call }) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.args },
      }));
      out.push(assistantMsg);
      for (const { call, result } of pairs) out.push(toolResultWire(result, call.id));
    }

    pendingAssistant = null;
    pendingTools = [];
  };

  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      if (!pendingAssistant) pendingAssistant = { content: '', calls: [] };
      if (m.content && m.content.trim()) {
        pendingAssistant.content = pendingAssistant.content
          ? `${pendingAssistant.content}\n${m.content}`
          : m.content;
      }
      for (const tc of m.tool_calls) {
        pendingAssistant.calls.push(normalizeToolCall(tc, pendingAssistant.calls.length));
      }
    } else if (m.role === 'tool') {
      pendingTools.push(m);
    } else {
      flush();
      out.push(nonToolWire(m));
    }
  }
  flush();
  return out;
}

/** Whether a persisted tool message answers a given accumulated call. */
function answersCall(call: PendingToolCall, msg: Message): boolean {
  if (msg.tool_call_id && msg.tool_call_id === call.id) return true;
  // Legacy fallback: a saved tool message predating the fix carries only a
  // name. Match on it, but only when there is no (mismatched) id present.
  return !msg.tool_call_id && msg.name === call.name;
}

/** Build the wire tool-call record, defaulting the id and stringifying args. */
function normalizeToolCall(tc: RawToolCall, index: number): PendingToolCall {
  const name = tc?.function?.name ?? tc?.name ?? 'unknown';
  const id = tc?.id ?? `call-${Date.now()}-${index}`;
  const rawArgs = tc?.function?.arguments ?? tc?.arguments;
  if (typeof rawArgs === 'string') return { id, name, args: rawArgs };
  try {
    return { id, name, args: JSON.stringify(rawArgs ?? {}) };
  } catch {
    return { id, name, args: '{}' };
  }
}

/** Wire shape of a tool result: role + tool_call_id + content. */
function toolResultWire(msg: Message, matchedCallId?: string): any {
  // A matched message either carries its own id (which equals the call id) or
  // was matched by name from a legacy save — in both cases the call id is the
  // value to emit, so it never falls back to the unmatchable 'unknown'.
  return {
    role: 'tool',
    tool_call_id: msg.tool_call_id ?? matchedCallId ?? 'unknown',
    content: msg.content,
  };
}

/**
 * Reconstruct a `data:` URL from raw base64, sniffing the MIME from the
 * magic bytes. `toApiBase64` (App.tsx) strips the original `data:` prefix
 * before the message reaches the service layer, so the true MIME is lost
 * here — sniff JPEG/PNG/GIF/WebP instead of hardcoding one, defaulting to
 * jpeg so we never mislabel the bytes we were handed (#566).
 */
export function asDataUrl(img: string): string {
  // A data URL already carries its MIME; pass it straight through.
  if (img.startsWith('data:')) return img;
  return `data:${base64MimeType(img) ?? 'image/jpeg'};base64,${img}`;
}

/** Detect a base-image MIME from the start of its base64 encoding, or null. */
function base64MimeType(b64: string): string | null {
  if (b64.startsWith('/9j/')) return 'image/jpeg'; // JPEG
  if (b64.startsWith('iVBOR')) return 'image/png'; // PNG
  if (b64.startsWith('R0lGOD')) return 'image/gif'; // GIF
  if (b64.startsWith('UklGR')) return 'image/webp'; // WebP
  return null;
}

/**
 * OpenAI `image_url` content parts for a message's attached images, or an
 * empty array. Text-only turns carry none, so the caller keeps the plain
 * string `content` form (#566).
 */
function messageImageParts(m: Message): { type: 'image_url'; image_url: { url: string } }[] {
  if (!m.images || m.images.length === 0) return [];
  return m.images.map(img => ({ type: 'image_url', image_url: { url: asDataUrl(img) } }));
}

/**
 * Wire shape of a plain message (user / system / text-only assistant). A
 * message carrying attached images is normalised into the multimodal
 * `{role, content:[...]}` form so the pixels reach an OpenAI-compatible
 * server (LM Studio / vLLM); text-only turns keep the string `content` so
 * llama.cpp builds that only understand it still work (#566).
 */
function nonToolWire(m: Message): any {
  const parts = messageImageParts(m);
  if (parts.length > 0) {
    return {
      role: m.role,
      content: [{ type: 'text', text: m.content ?? '' }, ...parts],
    };
  }
  return { role: m.role, content: m.content ?? '' };
}

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

/** Result of probing a single connection: the models, plus an error when the
 * connection could not be read. `error` is undefined whenever the server
 * answered (even with an empty list — that is "reachable but empty"). */
export interface ProbeResult {
  models: ConnectedModel[];
  error?: string;
}

/**
 * Probe a single connection by reading its model list, keeping the reason when
 * it fails. Unlike `fetchOpenAiModels`/`fetchOllamaConnectionModels` this never
 * silently swallows a failure into `[]`, and it ignores the `enabled` toggle so
 * an explicitly-off connection can still be tested (#589). Reachable-with-zero-
 * models yields `error === undefined` so the UI can report "reachable but empty"
 * rather than falsely flagging a working server as down.
 */
export async function probeConnection(
  conn: ModelConnection,
  opts?: { signal?: AbortSignal },
): Promise<ProbeResult> {
  const { signal } = opts ?? {};
  try {
    const headers: Record<string, string> = {};
    if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`;
    const base = conn.baseUrl.replace(/\/$/, '');
    if (conn.kind === 'openai') {
      const res = await fetch(`${base}/v1/models`, { headers, signal });
      if (!res.ok) {
        // OpenAI-dialect servers put the reason in the body (e.g. the missing-
        // token message on a 401) — surface it instead of a bare status (#589).
        const detail = await openAiErrorFromResponse(res, `HTTP ${res.status}`);
        return { models: [], error: detail.message };
      }
      const data = await res.json() as { data?: { id: string }[] };
      return { models: (data.data ?? []).map(m => ({
        id: `${conn.id}/${m.id}`,
        name: m.id,
        connectionId: conn.id,
        connectionName: conn.name,
        kind: conn.kind,
      })) };
    }
    const res = await fetch(`${base}/api/tags`, { headers, signal });
    if (!res.ok) {
      const detail = res.status === 401 || res.status === 403
        ? `HTTP ${res.status} — this server needs an API token (set one on the connection).`
        : `HTTP ${res.status}`;
      return { models: [], error: detail };
    }
    const data = await res.json() as { models?: any[] };
    return { models: (data.models ?? []).map((m: any) => ({
      id: `${conn.id}/${m.name}`,
      name: m.name,
      connectionId: conn.id,
      connectionName: conn.name,
      kind: 'ollama',
      size: typeof m.size === 'number' ? m.size : undefined,
      quantization: m.details?.quantization_level,
      parameterSize: m.details?.parameter_size,
    })) };
  } catch (err) {
    // A thrown fetch (offline, wrong port, CORS/origin reject) — keep the raw
    // message via the provider-aware path (#589). Use 'openai-compatible' only
    // when it really is one; the 'ollama' branch wrongly says "run ollama serve".
    const ctx = conn.kind === 'openai' ? 'openai-compatible' : 'generic';
    return { models: [], error: formatErrorLine(err, ctx, { label: conn.name, baseUrl: conn.baseUrl }) };
  }
}

/**
 * Fetch models from an OpenAI-compatible /v1/models endpoint.
 * Returns an empty array on any error (connection may be offline).
 */
export async function fetchOpenAiModels(conn: ModelConnection): Promise<ConnectedModel[]> {
  const { models } = await probeConnection(conn);
  return models;
}

/**
 * Fetch models from an Ollama /api/tags endpoint.
 * Returns an empty array on any error.
 */
export async function fetchOllamaConnectionModels(conn: ModelConnection): Promise<ConnectedModel[]> {
  const { models } = await probeConnection(conn);
  return models;
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
 * Extract an actionable message from a non-ok OpenAI-compatible response, for
 * the optional-`stream_options` retry guard (#575). Returns '' when the body is
 * unreadable (e.g. a test stub with no `.text()`), so the caller can fall back
 * to `statusText`.
 */
export async function openAiDetailText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return '';
    try {
      const data = JSON.parse(text);
      if (typeof data?.error?.message === 'string' && data.error.message.trim()) return data.error.message;
      if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
      if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
      if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail.trim();
    } catch {
      // non-JSON body — fall through to the raw text
    }
    return text;
  } catch {
    return '';
  }
}

/** Drop the optional `stream_options` block so a strict proxy no longer 400 (#575). */
export function stripStreamOptions(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if ('stream_options' in parsed) delete parsed.stream_options;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

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
  messages: Message[],
  options?: GenerationOptions,
  format?: StructuredOutputFormat,
  stream = true
): { url: string; headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`;
  // Normalize so a reloaded session replays without 400 on strict servers (#579).
  const normalized = normalizeOpenAiHistory(messages);
  // Translate Ollama-style sampling options into OpenAI top-level fields so
  // num_predict/top_p/stop/temperature actually reach the server (#583).
  const sampling = translateOpenAiSamplingOptions(options);
  return {
    url: `${conn.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`,
    headers,
    body: JSON.stringify({
      model,
      messages: normalized,
      ...(format ? { response_format: openAiResponseFormat(format) } : {}),
      stream,
      // Request usage on the final SSE frame so the tokens/sec footer can be
      // populated (#575). Only on streaming requests — vLLM/OpenAI reject
      // stream_options on non-streaming POSTs with a 400.
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...sampling,
    }),
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
  options?: GenerationOptions,
  format?: StructuredOutputFormat,
  signal?: AbortSignal,
  onGenStats?: (stats: GenStats) => void
): Promise<void> {
  const { url, headers, body } = buildOpenAiChatRequest(conn, model, messages, options, format);
  let res = await fetch(url, { method: 'POST', headers, body, signal });
  // A strict proxy may reject the optional stream_options field (a cosmetic
  // usage footer) and 400 the whole request. Retry once without it so the
  // footer never turns into "chat broken" (#575).
  if (!res.ok && !signal?.aborted) {
    const detail = await openAiDetailText(res);
    if (/stream_options/i.test(detail)) {
      res = await fetch(url, { method: 'POST', headers, body: stripStreamOptions(body), signal });
    }
  }
  if (!res.ok) throw await openAiErrorFromResponse(res, 'OpenAI stream error');

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error('Response body is null');

  let buf = '';
  let finishReason: string | null = null;
  const streamStart = Date.now();
  // Parse one SSE data line: track finish reason, emit the usage footer, and
  // stream content deltas. Returns 'done' so callers can exit on [DONE].
  const parse = (data: string): 'done' | 'ok' => {
    if (data === '[DONE]') return 'done';
    try {
      const chunk = JSON.parse(data);
      const first = chunk?.choices?.[0];
      if (first?.finish_reason) finishReason = first.finish_reason;
      // When include_usage is honoured the final frame is {choices:[], usage}.
      if (chunk?.usage) {
        const stats = usageToGenStats(chunk.usage, finishReason, Date.now() - streamStart);
        if (stats) onGenStats?.(stats);
      }
      const d = first?.delta;
      const delta = d?.content ?? '';
      const reasoning = d?.reasoning_content ?? d?.thinking ?? '';
      if (delta) onChunk(delta);
      if (reasoning) onChunk('', reasoning);
    } catch {
      // malformed SSE line — skip
    }
    return 'ok';
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      if (parse(line.slice(5).trim()) === 'done') return;
    }
  }
  // Flush any remaining buffered content after the stream ends (#466).
  if (buf.trim()) {
    const line = buf.trim();
    if (line.startsWith('data:')) {
      if (parse(line.slice(5).trim()) === 'done') return;
    }
  }
}
