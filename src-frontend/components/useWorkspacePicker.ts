/**
 * Shared workspace-folder picker state (#479/#480/#481/#482).
 *
 * The workspace capability (openWorkspace -> path-scoped Rust FS root, recent
 * roots, per-project binding) was fully implemented but only reachable from
 * inside the Files panel — which is closed on a fresh install — and from a
 * picker buried three levels deep in Settings. This hook gives every entry
 * point (welcome screen, header chip, composer hint) one shared code path so
 * they can never drift apart.
 */

import { useCallback, useEffect, useState } from 'react';
import { pickDirectory } from '../services/platform';
import {
  openWorkspace,
  closeWorkspace,
  loadWorkspaceState,
  getActiveRoot,
} from '../services/workspace';
import { openPanel, isPanelOpen } from './PanelShell';

/** localStorage flag: have we ever auto-revealed the files panel? (#480) */
const AUTO_REVEAL_KEY = 'ollama_gui_files_panel_autorevealed';

/** Last path segment of a workspace root, for compact display. */
export function workspaceLabel(root: string | null): string {
  if (!root) return 'No folder';
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

/**
 * Open the files panel the first time a workspace is opened (#480), so the
 * action has a visible result instead of silently changing hidden state.
 * Only fires once ever — after that the user's own layout choice wins.
 */
function revealFilesPanelOnce(): void {
  try {
    if (localStorage.getItem(AUTO_REVEAL_KEY)) return;
    localStorage.setItem(AUTO_REVEAL_KEY, '1');
  } catch {
    // localStorage unavailable — still reveal the panel this once.
  }
  if (!isPanelOpen('files')) openPanel('files');
}

export interface WorkspacePicker {
  /** Active workspace root, or null when none is open. */
  root: string | null;
  /** Basename of `root`, or "No folder". */
  label: string;
  /** Previously opened roots, most recent first. */
  recentRoots: string[];
  /** True while the native directory dialog is open. */
  picking: boolean;
  /** Show a native folder picker and open the chosen directory. */
  choose: () => Promise<void>;
  /** Open a known path directly (e.g. from the recent list). */
  openPath: (path: string) => Promise<void>;
  /** Close the active workspace (keeps the recent list). */
  close: () => void;
}

/**
 * Subscribes to `ollama-gui:workspace-changed` so every consumer re-renders
 * when the workspace changes anywhere — including the Settings project picker
 * and automatic project activation.
 */
export function useWorkspacePicker(): WorkspacePicker {
  const [root, setRoot] = useState<string | null>(() => getActiveRoot());
  const [recentRoots, setRecentRoots] = useState<string[]>(() => loadWorkspaceState().recentRoots);
  const [picking, setPicking] = useState(false);

  const sync = useCallback(() => {
    setRoot(getActiveRoot());
    setRecentRoots(loadWorkspaceState().recentRoots);
  }, []);

  useEffect(() => {
    window.addEventListener('ollama-gui:workspace-changed', sync);
    return () => window.removeEventListener('ollama-gui:workspace-changed', sync);
  }, [sync]);

  const openPath = useCallback(async (path: string) => {
    await openWorkspace(path);
    revealFilesPanelOnce();
    sync();
  }, [sync]);

  const choose = useCallback(async () => {
    setPicking(true);
    try {
      const dir = await pickDirectory();
      if (dir) await openPath(dir);
    } finally {
      setPicking(false);
    }
  }, [openPath]);

  const close = useCallback(() => {
    closeWorkspace();
    sync();
  }, [sync]);

  return { root, label: workspaceLabel(root), recentRoots, picking, choose, openPath, close };
}
