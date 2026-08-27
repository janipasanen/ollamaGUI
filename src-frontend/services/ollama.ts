export interface MessageFeedback {
  thumbs: 'up' | 'down';
  comment?: string;
  model: string;
  ts: number;
}

export interface Message {
  role: string;
  content: string;
  images?: string[];
  name?: string;
  tool_calls?: any[];
  /** Grounding sources for inline citations (#120); round-trips via storage.saveSession. */
  sources?: import('./citations').Source[];
  /** Local-only thumbs rating on assistant messages (#137). */
  feedback?: MessageFeedback;
  /** Which model produced this assistant message (#97). */
  producedByModel?: string;
  /** Reasoning/thinking trace from Ollama reasoning models (#241). */
  reasoning?: string;
  /** Epoch ms when the message was created (#253). */
  ts?: number;
  /** Generation stats from the final Ollama stream chunk (#297, #391, #392). */
  genStats?: { tokensPerSec?: number; evalCount?: number; totalDurationMs?: number; promptCount?: number; stopReason?: string };
  /** True when this assistant message is an error placeholder (#299). */
  isError?: boolean;
  /** True when the user cancelled generation mid-stream (#303). */
  wasCancelled?: boolean;
  /** End-of-run summary card appended after an agentic run (#549 rank 9). */
  runSummary?: boolean;
  /** OpenAI-compatible tool-result correlation id (#551): required by strict
   *  servers (LM Studio, vLLM) to pair a role:'tool' message with its call. */
  tool_call_id?: string;
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  message?: { role: string; content: string; thinking?: string };
  response: string;
  done: boolean;
  /** Top-level thinking trace (/api/generate reasoning models) (#241). */
  thinking?: string;
  /** Generation stats from the final done:true chunk (#297). */
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  /** Why generation stopped (`stop`/`length`/`tool_calls`/`load`) (#391). */
  done_reason?: string;
}

/**
 * Compute generation stats (tokens/sec, eval count, total duration in ms)
 * from the final `done:true` Ollama stream chunk (#297).
 * Ollama reports durations in nanoseconds.
 */
export interface GenStats {
  tokensPerSec?: number;
  evalCount?: number;
  totalDurationMs?: number;
  /** Prompt/context tokens consumed (#392). */
  promptCount?: number;
  /** Why generation stopped (#391). */
  stopReason?: string;
}

/**
 * Map Ollama's `done_reason` to a short, human-readable label (#391).
 * `load` means the model was only loaded (no generation) — treated as no reason.
 */
export function describeStopReason(reason?: string): string | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case 'stop': return 'stopped';
    case 'length': return 'length-limited';
    case 'tool_calls': return 'tool call';
    case 'load': return undefined;
    default: return reason;
  }
}

export function computeGenStats(chunk: Partial<OllamaResponse>): GenStats | undefined {
  const evalCount = chunk.eval_count;
  const evalDurationNs = chunk.eval_duration;
  const totalDurationNs = chunk.total_duration;
  // Allow stats to surface even when no completion tokens were generated
  // (e.g. a pure tool_calls turn), as long as there is a stop reason or
  // prompt tokens to report.
  const hasCompletion = typeof evalCount === 'number' && evalCount > 0;
  const stopReason = describeStopReason(chunk.done_reason);
  const promptCount = chunk.prompt_eval_count;
  const hasPrompt = typeof promptCount === 'number' && promptCount > 0;
  if (!hasCompletion && !stopReason && !hasPrompt) return undefined;
  const result: GenStats = {};
  if (hasCompletion) {
    result.evalCount = evalCount;
    if (typeof evalDurationNs === 'number' && evalDurationNs > 0) {
      result.tokensPerSec = evalCount / (evalDurationNs / 1e9);
    }
  }
  if (typeof totalDurationNs === 'number' && totalDurationNs > 0) {
    result.totalDurationMs = Math.round(totalDurationNs / 1e6);
  }
  if (hasPrompt) result.promptCount = promptCount;
  if (stopReason) result.stopReason = stopReason;
  return result;
}

/** Ollama generation options (subset). num_ctx is the key lever on small-RAM machines. */
export interface GenerationOptions {
  num_ctx?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  /** Max tokens to generate (Ollama's num_predict; -1 = unlimited). */
  num_predict?: number;
  stop?: string[];
}

/** Drop undefined/NaN fields; return undefined if nothing meaningful is set. */
export function cleanGenerationOptions(options?: GenerationOptions): GenerationOptions | undefined {
  if (!options) return undefined;
  const entries = Object.entries(options).filter(([, v]) =>
    v !== undefined && v !== null && !(typeof v === 'number' && Number.isNaN(v)));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/**
 * Build a descriptive Error from a non-ok Ollama response (#456).
 * Ollama returns the detailed failure reason as JSON `{ "error": "..." }` in the
 * response body (e.g. "model 'xyz' not found, try pulling it first"). Without
 * reading the body, callers only see a generic HTTP statusText ("Not Found",
 * "Internal Server Error") which prevents `formatError` from mapping to helpful
 * user-facing guidance. Falls back to `statusText` when the body is absent,
 * non-JSON, or has no `error` field.
 */
export async function ollamaErrorFromResponse(response: Response, prefix: string): Promise<Error> {
  let detail = response.statusText;
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string' && body.error.trim()) {
      detail = body.error.trim();
    }
  } catch {
    // Body is not JSON or cannot be consumed — keep statusText.
  }
  return new Error(`${prefix}: ${detail}`);
}

export async function fetchOllamaChatStream(
  model: string,
  messages: Message[],
  onChunk: (chunk: Partial<OllamaResponse>) => void,
  endpoint: string = 'http://localhost:11434/api/chat',
  isCloudModel: boolean = false,
  options?: GenerationOptions,
  signal?: AbortSignal,
  format?: 'json' | object,
  /** Optional request/stream timeout in ms (aborts via AbortSignal) (#224). */
  timeoutMs?: number,
): Promise<void> {
  // Cloud models are proxied by the *local* daemon (#483). Since Ollama 0.28+
  // the user runs `ollama signin` once and then uses a `-cloud`/`:cloud` tagged
  // model against localhost exactly like a local one -- the daemon forwards the
  // request and handles auth. Previously this bypassed the daemon and posted to
  // a hardcoded `cloud.ollama.ai` host with no credentials, so every cloud chat
  // failed and was then mis-reported as "Ollama is not running" (#484).
  // `isCloudModel` still drives UI labelling, but must not change the target.
  const apiEndpoint = endpoint;
  const cleaned = cleanGenerationOptions(options);

  // Combine the caller's AbortSignal with an optional timeout (#224).
  let timer: ReturnType<typeof setTimeout> | undefined;
  let combinedSignal = signal;
  if (timeoutMs && timeoutMs > 0) {
    const controller = new AbortController();
    combinedSignal = controller.signal;
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  let response: Response;
  try {
    response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, ...(cleaned ? { options: cleaned } : {}), ...(format ? { format } : {}) }),
      signal: combinedSignal,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    throw e;
  }

  if (!response.ok) {
    if (timer) clearTimeout(timer);
    throw await ollamaErrorFromResponse(response, 'Ollama API error');
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) {
    if (timer) clearTimeout(timer);
    throw new Error('Response body is null');
  }

  try {
    let streamBuf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamBuf += decoder.decode(value, { stream: true });
      const lines = streamBuf.split('\n');
      // Keep the last (possibly incomplete) line in the buffer for the next chunk.
      streamBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onChunk(JSON.parse(line));
        } catch (e) {
          console.error('Error parsing stream chunk', e);
        }
      }
    }
    // Flush any remaining buffered content after the stream ends.
    if (streamBuf.trim()) {
      try { onChunk(JSON.parse(streamBuf)); } catch { /* ignore trailing partial */ }
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A model entry from /api/tags, with size metadata used for the fit indicator. */
export interface ModelInfo {
  name: string;
  cloud: boolean;
  size?: number;           // bytes on disk
  quantization?: string;   // e.g. Q4_K_M
  parameterSize?: string;  // e.g. 7B
}

export async function fetchOllamaModels(
  endpoint: string = 'http://localhost:11434/api/tags',
): Promise<ModelInfo[]> {
  const response = await fetch(endpoint, { method: 'GET' });
  if (!response.ok) throw await ollamaErrorFromResponse(response, 'Ollama API error');
  const data = await response.json();

  const localModels: ModelInfo[] = data.models?.map((m: any) => ({
    name: m.name,
    cloud: false,
    size: typeof m.size === 'number' ? m.size : undefined,
    quantization: m.details?.quantization_level,
    parameterSize: m.details?.parameter_size,
  })) || [];

  return localModels;
}

export function isCloudModel(modelName: string): boolean {
  const CLOUD_SUFFIXES = ['-cloud', ':cloud'];
  return CLOUD_SUFFIXES.some(suffix => modelName.includes(suffix));
}

// ── Vision capability detection (#76) ────────────────────────────────────────

/** Known vision-capable model name prefixes/substrings (Ollama families). */
const VISION_FAMILIES = [
  'llava', 'llava-phi', 'bakllava', 'moondream', 'minicpm-v',
  'qwen2-vl', 'qwen2.5-vl', 'mistral-vision', 'gemma3',
  'llama3.2-vision', 'phi3-vision', 'pixtral', 'internvl',
];

/** Cache the result of /api/show to avoid repeated network calls. */
const _visionCache = new Map<string, boolean>();

/**
 * Returns true if the named model supports image inputs.
 *
 * First checks a curated allowlist of known vision families; if the model name
 * doesn't match, queries Ollama /api/show for the `projector_info` field which
 * is present on multimodal models.
 *
 * Results are cached per model per session.
 */
export async function modelSupportsVision(
  modelName: string,
  endpoint = 'http://localhost:11434',
): Promise<boolean> {
  if (_visionCache.has(modelName)) return _visionCache.get(modelName)!;

  const lower = modelName.toLowerCase();
  if (VISION_FAMILIES.some(f => lower.includes(f))) {
    _visionCache.set(modelName, true);
    return true;
  }

  try {
    const res = await fetch(`${endpoint}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
    });
    if (res.ok) {
      const data = await res.json();
      // projector_info is present on multimodal (vision) models.
      const hasVision = !!(data.projector_info || data.capabilities?.includes?.('vision'));
      _visionCache.set(modelName, hasVision);
      return hasVision;
    }
  } catch { /* network error — fall back to false */ }

  _visionCache.set(modelName, false);
  return false;
}

/** Clear the vision capability cache (useful in tests). */
export function clearVisionCache(): void {
  _visionCache.clear();
}

// ── Model capabilities: native context length + tool support ────────────────
//
// /api/show reports the model's trained context window (model_info key ending
// in ".context_length") and, on Ollama ≥0.4, a `capabilities` array including
// 'tools'. Both feed the auto-sized num_ctx and the agentic-model guidance —
// shipping a fixed 4096 into agent runs silently evicted the user's goal.

export interface ModelCapabilities {
  /** Trained context window, or null when /api/show is unavailable. */
  contextLength: number | null;
  /** True when the model advertises tool-calling support; null = unknown. */
  tools: boolean | null;
  /** Indicates that contextLength came from a built-in model profile. */
  contextSource?: 'server' | 'built-in';
}

/**
 * Capabilities for models whose Ollama package does not expose model_info.
 *
 * Custom/imported models can legitimately have a large context window while
 * `/api/show` omits the metadata that normally tells us about it. Keep these
 * entries narrowly scoped and use them only as a fallback; server metadata
 * always wins when it is available.
 */
export interface ModelProfile {
  contextLength: number;
  tools?: boolean;
}

const BUILT_IN_MODEL_PROFILES: Record<string, ModelProfile> = {
  'janimpasanen/ornith-1.5-256k-jani:35b': {
    contextLength: 262_144,
    tools: true,
  },
};

/** Return a built-in profile for a model with missing server metadata. */
export function getBuiltInModelProfile(modelName: string): ModelProfile | null {
  return BUILT_IN_MODEL_PROFILES[modelName.trim().toLowerCase()] ?? null;
}

const _capsCache = new Map<string, ModelCapabilities>();

export async function getModelCapabilities(
  modelName: string,
  endpoint = 'http://localhost:11434',
): Promise<ModelCapabilities> {
  const cached = _capsCache.get(modelName);
  if (cached) return cached;

  const result: ModelCapabilities = { contextLength: null, tools: null };
  try {
    const res = await fetch(`${endpoint}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
    });
    if (res.ok) {
      const data = await res.json();
      const info = data.model_info ?? {};
      const ctxKey = Object.keys(info).find(k => k.endsWith('.context_length'));
      const ctx = ctxKey ? Number(info[ctxKey]) : NaN;
      if (Number.isFinite(ctx) && ctx > 0) result.contextLength = ctx;
      if (Array.isArray(data.capabilities)) result.tools = data.capabilities.includes('tools');
    }
  } catch { /* network error — leave unknowns */ }

  // Ollama can serve custom models without model_info. Use the model's
  // explicit profile so auto-sizing and compaction still know the true native
  // limit instead of silently falling back to generic metadata.
  const profile = getBuiltInModelProfile(modelName);
  if (profile) {
    if (result.contextLength === null) {
      result.contextLength = profile.contextLength;
      result.contextSource = 'built-in';
    }
    if (result.tools === null && profile.tools !== undefined) result.tools = profile.tools;
  }

  _capsCache.set(modelName, result);
  return result;
}

/** Clear the capabilities cache (useful in tests). */
export function clearCapabilitiesCache(): void {
  _capsCache.clear();
}

/**
 * The context window to actually request: respects user-configured limits,
 * falls back to RAM-derived budget and native model context length.
 * Agentic runs get the full budget; plain chat stays leaner.
 */
// Import for context window configuration (circular dependency risk avoided by lazy loading)
type ContextConfigEntry = {
  contextWindow: number;
  compactionThreshold: number;
  autoDetected: boolean;
};

/** Lazy load model context configs to avoid circular dependencies */
let _contextConfigCache: Map<string, ContextConfigEntry> | null = null;
function loadContextConfigs(): Map<string, ContextConfigEntry> {
  if (!_contextConfigCache) {
    try {
      const stored = localStorage.getItem('model_context_config_v1');
      if (stored) {
        const data = JSON.parse(stored);
        _contextConfigCache = new Map(
          Object.entries(data).map(([k, v]: [string, any]) => [
            k,
            {
              contextWindow: v.contextWindow ?? 32768,
              compactionThreshold: v.compactionThreshold ?? 0.8,
              autoDetected: v.autoDetected ?? false,
            },
          ])
        );
      } else {
        _contextConfigCache = new Map();
      }
    } catch {
      _contextConfigCache = new Map();
    }
  }
  return _contextConfigCache;
}

export function autoNumCtx(
  caps: ModelCapabilities | null,
  totalRamBytes: number | null,
  agentic: boolean,
  connectionId?: string,
  modelName?: string,
): number {
  const gb = totalRamBytes ? totalRamBytes / 1024 ** 3 : 8;
  const ramBudget = gb >= 24 ? 32768 : gb >= 16 ? 16384 : gb >= 8 ? 8192 : 4096;
  const budget = agentic ? ramBudget : Math.min(ramBudget, 8192);

  // A built-in profile represents a remote/server-controlled model limit.
  // Honour it instead of applying the frontend machine's RAM budget (which
  // may be unrelated to the GX10 running Ollama).
  if (caps?.contextSource === 'built-in' && caps.contextLength) {
    return Math.max(4096, caps.contextLength);
  }
  
  // Get user-configured context window if available
  let configContextWindow: number | null = null;
  if (connectionId && modelName) {
    try {
      const configs = loadContextConfigs();
      const modelId = `${connectionId}/${modelName}`;
      configContextWindow = configs.get(modelId)?.contextWindow ?? null;
    } catch {
      // Error loading - fall back to other methods
    }
  }
  
  // Priority: user config > native model limit > RAM budget
  const modelMax = configContextWindow ?? caps?.contextLength ?? budget;
  return Math.max(4096, Math.min(modelMax, budget));
}

// ── Cloud models (#485) ──────────────────────────────────────────────────────

const CUSTOM_CLOUD_MODELS_KEY = 'ollama_gui_custom_cloud_models';

/**
 * User-specified cloud model names, persisted locally.
 *
 * Ollama does not expose a public "list every cloud model" endpoint, and the
 * catalogue changes faster than this app ships. Rather than hardcoding a list
 * that goes stale (the previous behaviour — several baked-in names are no
 * longer offered), let the user name any cloud model they have access to.
 */
export function loadCustomCloudModels(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_CLOUD_MODELS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n: unknown): n is string => typeof n === 'string' && !!n.trim());
  } catch {
    return [];
  }
}

export function saveCustomCloudModels(names: string[]): void {
  const cleaned = Array.from(new Set(names.map(n => n.trim()).filter(Boolean)));
  try { localStorage.setItem(CUSTOM_CLOUD_MODELS_KEY, JSON.stringify(cleaned)); } catch { /* quota */ }
}

/** Placeholder suggestions offered in the UI. Never the sole source (#485). */
export const SUGGESTED_CLOUD_MODELS: string[] = [
  'gpt-oss:20b-cloud',
  'gpt-oss:120b-cloud',
  'deepseek-v3.1:671b-cloud',
  'qwen3-coder:480b-cloud',
];

/**
 * Cloud models available to the user.
 *
 * Two real sources, replacing the old hardcoded array (#485):
 *  1. Discovered — cloud models the signed-in local daemon already reports via
 *     /api/tags (they carry a `-cloud` / `:cloud` suffix). Passing the local
 *     models in avoids a second network round-trip.
 *  2. User-specified — names the user added in Settings.
 */
export async function fetchCloudModels(localModels: ModelInfo[] = []): Promise<ModelInfo[]> {
  const discovered = localModels.filter(m => isCloudModel(m.name)).map(m => m.name);
  const names = Array.from(new Set([...discovered, ...loadCustomCloudModels()]));
  return names.map(name => ({ name, cloud: true }));
}

/** A curated local model the user can download with one click. */
export interface SuggestedModel {
  /** Exact `ollama pull` tag. */
  name: string;
  /** Human-friendly display name. */
  label: string;
  /** One-line description. */
  description: string;
  /** Approximate download size in GB. */
  sizeGB: number;
  /** Recommended minimum system RAM in GB to run comfortably. */
  minRamGB: number;
  /** Highlighted as the recommended default for modest hardware. */
  recommended?: boolean;
}

/**
 * Curated models to suggest for one-click download, ordered lightest-first.
 * `ministral-3:3b` is recommended as a strong default that runs on 8 GB RAM.
 */
export const SUGGESTED_MODELS: SuggestedModel[] = [
  { name: 'ministral-3:3b', label: 'Ministral 3B', description: 'Compact Mistral model — great quality-to-size balance, runs on 8 GB RAM.', sizeGB: 2.0, minRamGB: 8, recommended: true },
  { name: 'llama3.2:1b', label: 'Llama 3.2 1B', description: "Meta's tiniest model — fastest, runs almost anywhere.", sizeGB: 1.3, minRamGB: 4 },
  { name: 'gemma2:2b', label: 'Gemma 2 2B', description: "Google's efficient small model.", sizeGB: 1.6, minRamGB: 8 },
  { name: 'llama3.2:3b', label: 'Llama 3.2 3B', description: "Meta's small general-purpose model.", sizeGB: 2.0, minRamGB: 8 },
  { name: 'qwen2.5:3b', label: 'Qwen 2.5 3B', description: 'Strong multilingual + reasoning for its size.', sizeGB: 1.9, minRamGB: 8 },
  { name: 'phi3:mini', label: 'Phi-3 Mini', description: "Microsoft's 3.8B model, strong at reasoning.", sizeGB: 2.2, minRamGB: 8 },
  { name: 'qwen2.5-coder:7b', label: 'Qwen 2.5 Coder 7B', description: 'Coding-focused model; needs more memory.', sizeGB: 4.7, minRamGB: 16 },
  { name: 'llama3.1:8b', label: 'Llama 3.1 8B', description: 'Higher-quality general model; 16 GB+ RAM.', sizeGB: 4.7, minRamGB: 16 },
];

/**
 * Assemble a Modelfile string from discrete fields (#125).
 * Returns the Modelfile text ready to POST to Ollama /api/create.
 */
export function assembleModelfile(fields: {
  from: string;
  system?: string;
  temperature?: number;
  numCtx?: number;
  stop?: string;
  template?: string;
}): string {
  const lines: string[] = [];
  lines.push(`FROM ${fields.from}`);
  if (fields.system) lines.push(`\nSYSTEM """${fields.system}"""`);
  if (fields.temperature !== undefined) lines.push(`\nPARAMETER temperature ${fields.temperature}`);
  if (fields.numCtx !== undefined) lines.push(`\nPARAMETER num_ctx ${fields.numCtx}`);
  if (fields.stop) lines.push(`\nPARAMETER stop "${fields.stop}"`);
  if (fields.template) lines.push(`\nTEMPLATE """${fields.template}"""`);
  return lines.join('\n');
}

/**
 * Create a new Ollama model via POST /api/create (#125).
 * Streams NDJSON progress identical to pullOllamaModel.
 */
export async function createOllamaModel(
  name: string,
  modelfile: string,
  onProgress: (progress: { status?: string; error?: string }) => void,
  endpoint: string = 'http://localhost:11434/api/create'
): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, modelfile }),
  });

  if (!response.ok) throw await ollamaErrorFromResponse(response, 'Ollama create error');

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error('Response body is null');

  let createBuf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    createBuf += decoder.decode(value, { stream: true });
    const lines = createBuf.split('\n');
    createBuf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk = JSON.parse(line);
        onProgress(chunk);
        if (chunk.error) throw new Error(chunk.error);
      } catch (e) {
        // Re-throw chunk.error but silently skip malformed JSON lines (#455),
        // matching pullOllamaModel's behavior.
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  if (createBuf.trim()) {
    try {
      const chunk = JSON.parse(createBuf);
      onProgress(chunk);
      if (chunk.error) throw new Error(chunk.error);
    } catch (e) {
      // Re-throw chunk.error but silently skip malformed JSON (#455).
      if (e instanceof SyntaxError) return;
      throw e;
    }
  }
}

export async function pullOllamaModel(
  modelName: string,
  onProgress: (progress: { status?: string; completed?: number; total?: number }) => void,
  endpoint: string = 'http://localhost:11434/api/pull'
): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName }),
  });

  if (!response.ok) throw await ollamaErrorFromResponse(response, 'Ollama pull error');

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error('Response body is null');

  let pullBuf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pullBuf += decoder.decode(value, { stream: true });
    const lines = pullBuf.split('\n');
    pullBuf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onProgress(JSON.parse(line));
      } catch (e) {
        console.error('Error parsing pull chunk', e);
      }
    }
  }
  if (pullBuf.trim()) {
    try { onProgress(JSON.parse(pullBuf)); } catch { /* trailing partial */ }
  }
}

export async function deleteOllamaModel(
  modelName: string,
  endpoint: string = 'http://localhost:11434/api/delete'
): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName }),
  });
  if (!response.ok) throw await ollamaErrorFromResponse(response, 'Ollama delete error');
}

// ── Model memory management (#476) ───────────────────────────────────────────
// Ollama keeps loaded models in memory for `keep_alive` (default 5m). Codex GUI
// and other agentic tools surface which models are hot, let the user
// pre-load a model before a long run, and explicitly unload to free RAM.

/** A model currently loaded in Ollama's memory (from /api/ps). */
export interface RunningModel {
  name: string;
  model: string;
  /** Size in bytes occupied in memory. */
  size: number;
  /** VRAM portion of the size, if reported. */
  sizeVram?: number;
  /** Seconds since last access. */
  expiresAt?: string;
  /** How long the model stays in memory (human-readable, e.g. "4m59s"). */
  expiresRelativeToNow?: string;
}

/**
 * List models currently loaded in Ollama memory (GET /api/ps).
 * Returns an empty array on any error (server may be offline).
 */
export async function fetchRunningModels(
  endpoint: string = 'http://localhost:11434/api/ps',
): Promise<RunningModel[]> {
  const response = await fetch(endpoint, { method: 'GET' });
  if (!response.ok) throw await ollamaErrorFromResponse(response, 'Ollama API error');
  const data = await response.json();
  return (data.models ?? []).map((m: any) => ({
    name: m.name,
    model: m.model,
    size: typeof m.size === 'number' ? m.size : 0,
    sizeVram: typeof m.size_vram === 'number' ? m.size_vram : undefined,
    expiresAt: m.expires_at,
    expiresRelativeToNow: m.expires_relative_to_now,
  }));
}

/**
 * Load a model into Ollama memory so the first request doesn't pay the
 * cold-start latency (POST /api/generate with an empty prompt).
 * `keepAliveSeconds` controls how long the model stays resident (default 5m).
 */
export async function loadOllamaModel(
  modelName: string,
  keepAliveSeconds: number = 300,
  endpoint: string = 'http://localhost:11434/api/generate',
): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, keep_alive: `${keepAliveSeconds}s`, stream: false }),
  });
  if (!response.ok) throw await ollamaErrorFromResponse(response, 'Ollama load error');
}

/**
 * Unload a model from Ollama memory to free RAM/VRAM.
 * Sends `keep_alive: 0` which tells Ollama to immediately evict the model.
 */
export async function unloadOllamaModel(
  modelName: string,
  endpoint: string = 'http://localhost:11434/api/generate',
): Promise<void> {
  const response = await fetch(endpoint, {
 method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, keep_alive: 0, stream: false }),
  });
  if (!response.ok) throw await ollamaErrorFromResponse(response, 'Ollama unload error');
}

/** Ollama server version info (GET /api/version). */
export interface OllamaVersionInfo {
  version: string;
}

/**
 * Fetch the Ollama server version (GET /api/version).
 * Useful for feature-gating and displaying in the UI settings panel.
 */
export async function fetchOllamaVersion(
  endpoint: string = 'http://localhost:11434/api/version',
): Promise<OllamaVersionInfo> {
  const response = await fetch(endpoint, { method: 'GET' });
  if (!response.ok) throw await ollamaErrorFromResponse(response, 'Ollama API error');
  const data = await response.json();
  return { version: data.version ?? 'unknown' };
}
