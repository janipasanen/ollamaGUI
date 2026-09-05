/**
 * Auto-commit after agentic file edits (#401, Aider parity).
 *
 * Opt-in: when enabled, every file edit applied through the diff-review flow
 * (write_file / apply_edit / apply_patch) is staged and committed to the
 * workspace git repo with a descriptive message. This mirrors Aider's
 * auto-commit-per-edit workflow and makes agent changes easy to revert via
 * `git revert` / the Git panel / checkpoints.
 */

import { gitStage, gitCommit, gitLog, gitReset } from './git';
import { getWorkspaceRoot } from './fileTools';

const SETTING_KEY = 'ollama_gui_auto_commit_edits';

export function loadAutoCommitEdits(): boolean {
  // Default ON: auto-commits are the undo mechanism for autonomous edits
  // (revertible via /gitundo) and are non-fatal outside git repos. An explicit
  // stored 'false' still disables them.
  try {
    return JSON.parse(localStorage.getItem(SETTING_KEY) ?? 'true') === true;
  } catch {
    return true;
  }
}

/** Prefix that marks a commit as an agent auto-commit (revertible by /gitundo). */
export const AUTO_COMMIT_PREFIX = 'ollama-gui:';

export interface UndoLastAutoCommitResult {
  reverted: boolean;
  subject?: string;
  error?: string;
}

/**
 * Revert the most recent commit if it is an agent auto-commit (#402, Aider /undo
 * parity). Hard-resets HEAD~1 so the worktree returns to the pre-edit state.
 * Refuses to touch commits that were not made by the auto-commit flow.
 */
export async function undoLastAutoCommit(): Promise<UndoLastAutoCommitResult> {
  const cwd = getWorkspaceRoot();
  if (!cwd) return { reverted: false, error: 'No workspace open' };
  try {
    const log = await gitLog(cwd, 1);
    if (log.length === 0) return { reverted: false, error: 'No commits yet' };
    const last = log[0];
    if (!last.subject.startsWith(AUTO_COMMIT_PREFIX)) {
      return { reverted: false, subject: last.subject, error: 'Last commit is not an agent auto-commit' };
    }
    await gitReset(cwd, 1);
    return { reverted: true, subject: last.subject };
  } catch (err) {
    return { reverted: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export function saveAutoCommitEdits(on: boolean): void {
  try { localStorage.setItem(SETTING_KEY, JSON.stringify(on)); } catch { /* ignore */ }
}

/** Build a concise, attributable commit message for an applied edit. */
export function makeCommitMessage(path: string, label?: string): string {
  const action = (label ?? 'edit').trim() || 'edit';
  return `ollama-gui: ${action} — ${path}`;
}

export interface AutoCommitResult {
  committed: boolean;
  hash?: string;
  error?: string;
}

/**
 * Stage `path` and commit it if auto-commit is enabled and a workspace git repo
 * is open. Returns `{ committed: false }` (non-fatal) when disabled, no
 * workspace, or the commit fails (e.g. not a git repo, nothing to commit).
 */
export async function autoCommitEdit(
  path: string,
  label?: string,
  enabled: boolean = loadAutoCommitEdits(),
): Promise<AutoCommitResult> {
  if (!enabled) return { committed: false };
  const cwd = getWorkspaceRoot();
  if (!cwd) return { committed: false, error: 'No workspace open' };
  try {
    await gitStage(cwd, [path]);
    const res = await gitCommit(cwd, makeCommitMessage(path, label));
    return { committed: true, hash: res.hash };
  } catch (err) {
    return { committed: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
