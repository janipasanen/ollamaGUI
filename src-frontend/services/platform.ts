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
