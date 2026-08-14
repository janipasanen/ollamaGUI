// Write-through disk mirror for the localStorage-backed stores (sessions /
// projects / folders).
//
// storage.ts stays fully synchronous (its ~50 call sites depend on that);
// every successful save additionally schedules a fire-and-forget mirror of the
// exact same JSON payload to the Rust backend, which writes it atomically to
// <app_data_dir>/store/<key>.json (persist_store / load_store in lib.rs).
// At boot, App.tsx hydrates localStorage from the disk mirror when a store is
// missing — recovery after WebView eviction or a cleared localStorage.
//
// Outside Tauri (browser dev / vitest) every call degrades to a silent no-op.

/** Trailing-edge debounce per key so token-streaming saves (a saveSession per
 *  chunk) collapse into one disk write instead of hammering the FS. */
const DEBOUNCE_MS = 500;

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/**
 * Synchronous Tauri detection. Lets App.tsx skip the async boot-hydration
 * path entirely in browser dev / tests, keeping loadInitialData's first
 * storage reads synchronous there (several tests rely on that).
 */
export function hasTauri(): boolean {
  return typeof window !== 'undefined'
    && '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>);
}

async function tauri(): Promise<Invoke | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke as Invoke;
  } catch {
    return null; // Tauri unavailable — mirror becomes a no-op
  }
}

const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; json: string }>();

async function writeNow(key: string, json: string): Promise<void> {
  const invoke = await tauri();
  if (!invoke) return;
  try {
    await invoke('persist_store', { key, json });
  } catch {
    /* best-effort mirror — never surfaces to the UI */
  }
}

/**
 * Fire-and-forget: schedule `json` to be mirrored to
 * `<app_data_dir>/store/<key>.json`. Rapid calls for the same key within
 * DEBOUNCE_MS collapse into a single write of the LATEST payload.
 */
export function mirrorToDisk(key: string, json: string): void {
  const prev = pending.get(key);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    pending.delete(key);
    void writeNow(key, json);
  }, DEBOUNCE_MS);
  pending.set(key, { timer, json });
}

/** Read the last mirrored payload for `key`, or null when there is none
 *  (never persisted, or Tauri unavailable). */
export async function loadFromDisk(key: string): Promise<string | null> {
  const invoke = await tauri();
  if (!invoke) return null;
  try {
    return ((await invoke('load_store', { key })) as string | null) ?? null;
  } catch {
    return null;
  }
}

/** Test helper: cancel pending debounced mirrors so timers don't leak
 *  between tests. */
export function _clearPendingMirrors(): void {
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
}
