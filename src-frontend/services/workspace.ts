/**
 * Workspace state service (#85).
 *
 * Tracks the active workspace root and a list of recently opened roots so the
 * file-tree panel can restore state across sessions. The active root is synced
 * to the Rust backend via `setWorkspaceRoot` from fileTools so all filesystem
 * commands are scoped to the chosen directory.
 */

import { setWorkspaceRoot as fsSetRoot, setWorkspaceRoots, clearWorkspaceRoot, getWorkspaceRoot, listDir } from './fileTools';
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
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
  notifyWorkspaceChanged();
}

/** Clear the active workspace (does not purge recent list). */
export function closeWorkspace(): void {
  const state = loadWorkspaceState();
  saveWorkspaceState({ ...state, root: null });
  clearWorkspaceRoot();
  notifyWorkspaceChanged();
}

/** Remove a path from the recent list. */
export function removeRecentWorkspace(path: string): void {
  const state = loadWorkspaceState();
  saveWorkspaceState({ ...state, recentRoots: state.recentRoots.filter(r => r !== path) });
}

/** Broadcast a custom event so UI panels can refresh when the workspace changes (#380). */
function notifyWorkspaceChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ollama-gui:workspace-changed'));
  }
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

// ── Multi-folder projects (#492) ─────────────────────────────────────────────

/**
 * Every folder a project exposes, primary first, de-duplicated.
 *
 * Reads `workspaceRoots` when present and falls back to the legacy single
 * `workspaceRoot`, so projects saved before multi-folder support keep working
 * without a migration step. Always use this instead of reading either field.
 */
export function projectRoots(
  project: { workspaceRoot?: string; workspaceRoots?: string[] } | null | undefined,
): string[] {
  if (!project) return [];
  const list = project.workspaceRoots?.length
    ? project.workspaceRoots
    : (project.workspaceRoot ? [project.workspaceRoot] : []);
  return Array.from(new Set(list.filter(r => !!r && r.trim())));
}

/**
 * Point the backend at every folder of a project (#492).
 *
 * The first root stays the "active" one for UI and relative-path purposes, so
 * the file tree and recent list behave as before; the remaining roots are
 * additionally granted filesystem access so the agent can work across repos.
 */
export async function openWorkspaceRoots(roots: string[]): Promise<void> {
  const cleaned = Array.from(new Set(roots.filter(r => !!r && r.trim())));
  if (cleaned.length === 0) { closeWorkspace(); return; }

  await setWorkspaceRoots(cleaned);
  const state = loadWorkspaceState();
  const recent = [cleaned[0], ...state.recentRoots.filter(r => r !== cleaned[0])].slice(0, MAX_RECENT);
  saveWorkspaceState({ root: cleaned[0], recentRoots: recent });
  notifyWorkspaceChanged();
}
