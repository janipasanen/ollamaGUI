// MLX acceleration service (Apple Silicon)
//
// MLX is Apple's ML array framework. Ollama serves MLX-format models natively
// on Apple Silicon, so there is nothing to enable or configure: this module
// only detects whether the machine can accelerate MLX weights and recognises
// MLX-capable models by name. When the user selects a local MLX model on a
// capable machine, acceleration is simply active — no toggles, no separate
// server lifecycle.

export interface MlxAvailability {
  available: boolean;
  apple_silicon: boolean;
  mlx_lm: boolean;
  python: string | null;
  version: string | null;
  reason: string;
}

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

/**
 * True if a model name indicates MLX-capable weights (#544).
 *
 * Ollama surfaces these by tag (e.g. `qwen3.5:4b-mlx`, `gemma4:12b-mlx`), so
 * the name is the only signal available from /api/tags. Callers must gate on
 * real MLX availability before *recommending* these — the name alone says the
 * weights are MLX-format, not that this machine can accelerate them.
 */
export function isMlxModelName(name: string): boolean {
  return /(^|[-_:.])mlx([-_:.]|$)/i.test(name);
}
