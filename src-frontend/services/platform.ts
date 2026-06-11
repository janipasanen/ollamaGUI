// Platform helpers: native dialogs + binary probing, with graceful no-op
// fallbacks when Tauri isn't available (browser dev / tests).

/** Check whether an executable (docker, uvx, npx, …) is on PATH. Returns false outside Tauri. */
export async function probeBinary(name: string): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke('probe_binary', { name })) as boolean;
  } catch {
    return false; // Tauri unavailable — caller should degrade to manual entry
  }
}

/** Open a native directory picker. Returns the chosen path, or null if cancelled/unavailable. */
export async function pickDirectory(): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({ directory: true, multiple: false });
    return typeof result === 'string' ? result : null;
  } catch {
    return null; // Tauri/dialog unavailable
  }
}

/** Detect total/available system memory. Returns null outside Tauri (hides the fit indicator). */
export async function getSystemMemory(): Promise<{ total_bytes: number; available_bytes: number; apple_silicon: boolean } | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke('get_system_memory')) as any;
  } catch {
    return null;
  }
}

/** Append a path as a CLI arg to a command, quoting it if it contains spaces. */
export function appendPathArg(command: string, path: string): string {
  const arg = /\s/.test(path) ? `"${path}"` : path;
  const base = command.trimEnd();
  return base ? `${base} ${arg}` : arg;
}

/** Open a native file picker. Returns the chosen path, or null if cancelled/unavailable. */
export async function pickFile(): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({ directory: false, multiple: false });
    return typeof result === 'string' ? result : null;
  } catch {
    return null;
  }
}
