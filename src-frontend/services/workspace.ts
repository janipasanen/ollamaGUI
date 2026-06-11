/**
 * Workspace state service (#85).
 *
 * Tracks the active workspace root and a list of recently opened roots so the
 * file-tree panel can restore state across sessions. The active root is synced
 * to the Rust backend via `setWorkspaceRoot` from fileTools so all filesystem
 * commands are scoped to the chosen directory.
 */

import { setWorkspaceRoot as fsSetRoot, getWorkspaceRoot, listDir } from './fileTools';
import type { DirEntry } from './fileTools';

export interface WorkspaceState {
  root: string | null;
  recentRoots: string[];
}

const STORAGE_KEY = 'ollama_gui_workspace';
const MAX_RECENT = 10;

export function loadWorkspaceState(): WorkspaceState {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') ?? { root: null, recentRoots: [] };
  } catch {
    return { root: null, recentRoots: [] };
  }
}

function saveWorkspaceState(state: WorkspaceState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Set the active workspace root.
 * - Calls the Rust backend to enforce path-scoped filesystem capability.
 * - Persists the root and prepends it to `recentRoots`.
 */
export async function openWorkspace(path: string): Promise<void> {
  await fsSetRoot(path);
  const state = loadWorkspaceState();
  const recent = [path, ...state.recentRoots.filter(r => r !== path)].slice(0, MAX_RECENT);
  saveWorkspaceState({ root: path, recentRoots: recent });
}

/** Clear the active workspace (does not purge recent list). */
export function closeWorkspace(): void {
  const state = loadWorkspaceState();
  saveWorkspaceState({ ...state, root: null });
}

/** Remove a path from the recent list. */
export function removeRecentWorkspace(path: string): void {
  const state = loadWorkspaceState();
  saveWorkspaceState({ ...state, recentRoots: state.recentRoots.filter(r => r !== path) });
}

/** Current active root (in-process + backend). `null` if none opened this session. */
export function getActiveRoot(): string | null {
  return getWorkspaceRoot();
}

/** List the contents of a directory within the active workspace. */
export async function listWorkspaceDir(path?: string): Promise<DirEntry[]> {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No workspace open.');
  return listDir(path ?? root);
}
