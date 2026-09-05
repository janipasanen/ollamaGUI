/**
 * Folder trust for project rules (#608).
 *
 * Opening a cloned repository is otherwise enough to let that repository write
 * the agent's system prompt: `AGENTS.md`/`CLAUDE.md` is read from the workspace
 * root and injected into the SYSTEM message, where in most models it outranks
 * the user's own instructions. With shell, filesystem, git and browser tools in
 * the app, the payoff for a hostile file is full local compromise — and the
 * user never sees the injected block. VS Code, Claude Code and Cursor all gate
 * this behind an explicit decision about the folder, and so do we.
 *
 * Keyed on the CANONICAL ROOT PATH, deliberately not on a hash of the file:
 * hash-keying re-prompts on every edit to your own AGENTS.md, in the repo you
 * are actively developing — which is this app's primary use case. The codebase
 * has already been burned by exactly that shape of prompt fatigue (see the note
 * on exact-string CLI matching in services/tools.ts), and a treadmill trains
 * users to approve without reading, which is worse than no prompt at all.
 *
 * Persisted rather than session-scoped, again unlike the CLI allowlists: "I
 * trust this folder" is a durable judgment about a location, not a stale
 * auto-approval for one action.
 */

const STORAGE_KEY = 'trusted_folders';

/** Normalise so `/x`, `/x/` and `/x/.` are one decision, not three. */
export function canonicalRoot(path: string): string {
  const trimmed = String(path ?? '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+\.?$/, '') || '/';
}

export function loadTrustedFolders(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function save(list: string[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

/** True when the user has explicitly trusted this folder. */
export function isFolderTrusted(root: string): boolean {
  const key = canonicalRoot(root);
  if (!key) return false;
  return loadTrustedFolders().includes(key);
}

export function trustFolder(root: string): void {
  const key = canonicalRoot(root);
  if (!key) return;
  const list = loadTrustedFolders();
  if (!list.includes(key)) save([...list, key]);
}

export function untrustFolder(root: string): void {
  const key = canonicalRoot(root);
  save(loadTrustedFolders().filter(r => r !== key));
}

export function clearTrustedFolders(): void {
  save([]);
}
