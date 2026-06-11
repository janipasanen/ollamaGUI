// MLX acceleration service (Apple Silicon)
//
// MLX is Apple's ML array framework. When `mlx-lm` is installed it provides
// `mlx_lm.server`, an OpenAI-compatible inference server. This module:
//   1. Detects MLX availability (Rust `check_mlx_available`), with a graceful
//      no-op fallback when Tauri isn't present (tests / browser dev).
//   2. Manages the MLX server lifecycle.
//   3. Streams chat completions / embeddings from the MLX server.
//   4. Persists the layered MLX settings (the Settings toggle hierarchy).
//
// Design rule: if MLX is NOT available, none of this is used — callers check
// `availability.available` (or `isMlxActive(settings, availability)`) first.

import { Message } from './ollama';

export interface MlxAvailability {
  available: boolean;
  apple_silicon: boolean;
  mlx_lm: boolean;
  python: string | null;
  version: string | null;
  reason: string;
}

export interface MlxServerStatus {
  running: boolean;
  model: string | null;
  port: number | null;
}

/**
 * Layered MLX settings, mirroring the Settings UI toggle hierarchy:
 *   fullInference (master) ⊇ accelerateEmbeddings ⊇ detectIndicate
 * Plus the cloud-brain / local-worker multi-agent mode.
 */
export interface MlxSettings {
  /** Master: route chat inference through the MLX server. Implies the toggles below. */
  fullInference: boolean;
  /** Local MLX model id (HF repo, e.g. mlx-community/Llama-3.2-3B-Instruct-4bit). */
  localModel: string;
  /** Port the mlx_lm.server listens on. */
  serverPort: number;
  /** Use MLX for embeddings / auxiliary compute (search, RAG, titles). */
  accelerateEmbeddings: boolean;
  /** Base opt-in: detect MLX and show the accelerator indicator. */
  detectIndicate: boolean;
  /** Multi-agent: cloud model is the "brain" (planner), local model is the "worker". */
  cloudBrainLocalWorker: boolean;
  /** Cloud model used as the brain/orchestrator. */
  brainModel: string;
  /** Local model (MLX or Ollama) used as the worker/executor. */
  workerModel: string;
}

export const DEFAULT_MLX_SETTINGS: MlxSettings = {
  fullInference: false,
  localModel: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
  serverPort: 8080,
  accelerateEmbeddings: false,
  detectIndicate: false,
  cloudBrainLocalWorker: false,
  brainModel: '',
  workerModel: '',
};

const STORAGE_KEY = 'ollama_gui_mlx_settings';

const UNAVAILABLE: MlxAvailability = {
  available: false,
  apple_silicon: false,
  mlx_lm: false,
  python: null,
  version: null,
  reason: 'Tauri not available — MLX detection unavailable.',
};

/** Lazily import the Tauri invoke, returning null outside Tauri (tests / browser). */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke(cmd, args)) as T;
  } catch {
    return null;
  }
}

/** Detect MLX availability. Never throws — returns an unavailable result on any error. */
export async function checkMlxAvailable(): Promise<MlxAvailability> {
  const result = await tauriInvoke<MlxAvailability>('check_mlx_available');
  return result ?? UNAVAILABLE;
}

export async function startMlxServer(model: string, port: number): Promise<MlxServerStatus> {
  const result = await tauriInvoke<MlxServerStatus>('mlx_start_server', { model, port });
  return result ?? { running: false, model: null, port: null };
}

export async function stopMlxServer(): Promise<MlxServerStatus> {
  const result = await tauriInvoke<MlxServerStatus>('mlx_stop_server');
  return result ?? { running: false, model: null, port: null };
}

export async function mlxServerStatus(): Promise<MlxServerStatus> {
  const result = await tauriInvoke<MlxServerStatus>('mlx_server_status');
  return result ?? { running: false, model: null, port: null };
}

/**
 * Enforce the toggle hierarchy: enabling a higher tier enables every tier below it.
 *   fullInference → accelerateEmbeddings → detectIndicate
 * Returns a NEW settings object (does not mutate the input).
 */
export function applyMlxHierarchy(settings: MlxSettings): MlxSettings {
  const next = { ...settings };
  if (next.fullInference) {
    next.accelerateEmbeddings = true;
    next.detectIndicate = true;
  } else if (next.accelerateEmbeddings) {
    next.detectIndicate = true;
  }
  return next;
}

export function loadMlxSettings(): MlxSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MLX_SETTINGS };
    const parsed = JSON.parse(raw);
    return applyMlxHierarchy({ ...DEFAULT_MLX_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_MLX_SETTINGS };
  }
}

export function saveMlxSettings(settings: MlxSettings): MlxSettings {
  const normalized = applyMlxHierarchy(settings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    /* ignore quota / unavailable storage */
  }
  return normalized;
}

/** True when MLX should actually be used for chat inference right now. */
export function isMlxActive(settings: MlxSettings, availability: MlxAvailability): boolean {
  return availability.available && settings.fullInference;
}

function mlxBaseUrl(settings: MlxSettings): string {
  return `http://127.0.0.1:${settings.serverPort}`;
}

/**
 * Stream a chat completion from the MLX server (OpenAI-compatible SSE).
 * Calls `onChunk` with each incremental content delta.
 */
export async function fetchMlxChatStream(
  model: string,
  messages: Message[],
  onChunk: (delta: string) => void,
  port: number = 8080,
  options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options?.signal,
    body: JSON.stringify({
      model,
      // MLX server expects role/content; drop tool/image fields it can't use.
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      ...(options?.temperature != null ? { temperature: options.temperature } : {}),
      ...(options?.maxTokens != null ? { max_tokens: options.maxTokens } : {}),
    }),
  });

  if (!response.ok) throw new Error(`MLX server error: ${response.status} ${response.statusText}`);

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error('MLX response body is null');

  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // keep incomplete trailing line
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || !line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch {
        /* skip malformed SSE frame */
      }
    }
  }
}

/** Request embeddings from the MLX server (OpenAI-compatible). Returns vectors. */
export async function fetchMlxEmbeddings(
  input: string | string[],
  model: string,
  port: number = 8080,
): Promise<number[][]> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  });
  if (!response.ok) throw new Error(`MLX embeddings error: ${response.status}`);
  const data = await response.json();
  return (data.data ?? []).map((d: any) => d.embedding as number[]);
}
