/**
 * Model fallback chain (#669).
 *
 * A run is pinned to one model. When that model cannot serve the request — it
 * was deleted, the daemon cannot load it, the host is down — every remaining
 * turn fails for a reason another model would not have. This module decides
 * whether a failure is *model-scoped* (switch) or belongs to the request itself
 * (do not switch: a context-length overflow or a bad tool schema fails
 * identically everywhere, and an auth failure belongs to the connection).
 *
 * Switching is deliberately conservative: the first failure of a turn that has
 * emitted nothing is retried once per fallback model, in order, and the run
 * stays on whichever model answered.
 */

export type FailureScope = 'abort' | 'auth' | 'request' | 'model';

export const FALLBACK_MODELS_KEY = 'ollama_gui_fallback_models';

function messageOf(error: unknown): string {
  if (!error) return '';
  const e = error as { message?: string; name?: string };
  return `${e.name ?? ''} ${e.message ?? String(error)}`.toLowerCase();
}

function statusOf(error: unknown): number | undefined {
  const s = (error as { status?: unknown })?.status;
  return typeof s === 'number' ? s : undefined;
}

/**
 * Classify a failure. The default is `request`: when in doubt, do not switch,
 * because switching hides the real error behind a second, unrelated failure.
 */
export function classifyFailure(error: unknown, status?: number): FailureScope {
  const msg = messageOf(error);
  const code = status ?? statusOf(error);

  // Aborts are the user's decision, never a model problem.
  if (/abort/.test(msg)) return 'abort';

  if (code === 401 || code === 403) return 'auth';
  if (/unauthorized|forbidden|api key|invalid key|authentication/.test(msg)) return 'auth';

  // The prompt cannot fit or is malformed: every model on this host says no.
  if (code === 413 || code === 422) return 'request';
  if (/context (length|window)|too many tokens|prompt is too long|exceeds.*context/.test(msg)) return 'request';
  if (/invalid (request|tool|schema|format)|json.*(invalid|parse)/.test(msg)) return 'request';

  // The model itself is the problem: missing, unloadable, or the daemon failed
  // while serving it.
  if (code === 404 && /model/.test(msg)) return 'model';
  if (/model .*(not found|does not exist|unknown|missing)|no such model|pull.*model/.test(msg)) return 'model';
  if (code === 500 || code === 503) return 'model';
  if (/failed to (load|start) model|out of memory|cuda.*(error|oom)|model.*(crash|load)/.test(msg)) return 'model';

  // A dead host: the fallback may live on another connection, so it qualifies,
  // but only after the in-loop network retries have already been exhausted.
  if (error instanceof TypeError) return 'model';

  return 'request';
}

/** Ordered candidates, excluding the model already in use, deduplicated. */
export function fallbackCandidates(configured: string[] | undefined, current: string): string[] {
  const seen = new Set([current]);
  const out: string[] = [];
  for (const raw of configured ?? []) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Short human-readable reason for the transcript, with the HTTP status if any. */
export function switchReason(error: unknown): string {
  const msg = (error as { message?: string })?.message ?? String(error);
  const status = statusOf(error);
  const short = msg.replace(/\s+/g, ' ').slice(0, 160);
  return status ? `HTTP ${status}: ${short}` : short;
}

export function loadFallbackModels(): string[] {
  try {
    const raw = localStorage.getItem(FALLBACK_MODELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

export function saveFallbackModels(models: string[]): void {
  try {
    localStorage.setItem(FALLBACK_MODELS_KEY, JSON.stringify(models));
  } catch {
    // Storage unavailable: the chain still applies to the current session.
  }
}
