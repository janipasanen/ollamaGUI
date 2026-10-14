import { Message } from './ollama';
import type { BranchState } from './branching';
import { mirrorToDisk } from './rustStore';

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  model: string;
  // Organization (#133)
  folderId?: string;
  tags?: string[];
  pinned?: boolean;
  archived?: boolean;
  // Conversation branching (#98)
  branchState?: BranchState;
  // Projects (#92)
  projectId?: string;
  /** Per-session working directory (#550): where this session's agent works.
   *  Unset = the project's primary folder. Survives session switches. */
  workingDir?: string;
}

// ─── Projects (#92) ───────────────────────────────────────────────────────────
export interface Project {
  id: string;
  name: string;
  /**
   * Absolute path to the primary workspace root (may be empty string when not
   * yet set). Kept as the first entry of `workspaceRoots`; retained so projects
   * saved before multi-folder support keep working unchanged (#492).
   */
  workspaceRoot: string;
  /**
   * Every folder in this project, primary first (#492). A project may span
   * several git repositories. Undefined on projects created before this field
   * existed — use `projectRoots()` rather than reading it directly.
   */
  workspaceRoots?: string[];
  /** Project-scoped instructions prepended to the system prompt. */
  instructions: string;
  createdAt: number;
  /** Per-project primary chat model (#171). When set, activating this project switches the model. */
  model?: string;
  /** Per-project cloud brain model for MLX orchestration (#171). */
  brainModel?: string;
  /** Per-project local worker model for MLX orchestration (#171). */
  workerModel?: string;
}

export interface Folder {
  id: string;
  name: string;
  order: number;
}

const SESSIONS_KEY = 'ollama_gui_sessions';
const FOLDERS_KEY = 'ollama_gui_folders';
const PROJECTS_KEY = 'ollama_gui_projects';

// Disk-mirror keys (Rust writes <app_data_dir>/store/<key>.json). App.tsx
// hydrates localStorage from these at boot when the store is missing.
export const DISK_SESSIONS_KEY = 'sessions';
export const DISK_FOLDERS_KEY = 'folders';
export const DISK_PROJECTS_KEY = 'projects';

/** Ensure organization fields exist on legacy sessions. */
function migrate(s: any): ChatSession {
  return {
    ...s,
    tags: Array.isArray(s.tags) ? s.tags : [],
    pinned: !!s.pinned,
    archived: !!s.archived,
  };
}

/**
 * How much a localStorage read can be trusted (#599).
 *
 *  - 'ok'         — parsed cleanly.
 *  - 'absent'     — the key is not there. A genuinely fresh install.
 *  - 'unreadable' — present but unparseable, non-array, or getItem threw.
 *
 * The distinction matters because an empty array means two opposite things.
 * Treating 'unreadable' as "no sessions" is how one bad value used to become
 * permanent loss: the next save rebuilt the array from nothing and mirrored
 * that over the good disk copy — defeating the durable store in exactly the
 * situation it exists for.
 */
export type ReadStatus = 'ok' | 'absent' | 'unreadable';

/**
 * The authoritative session list once anything has been read or written (#600).
 *
 * localStorage stops accepting writes at quota, but the app keeps working and
 * the disk mirror keeps taking the payload. Rebuilding the list from the now
 * stale localStorage on every save was what made that guarantee hollow: turn 2
 * of an over-quota chat rebuilt from a list that never got turn 1, so nothing
 * further was written anywhere, and a second chat clobbered the first on disk.
 *
 * Holding it in memory keeps `getSessions()` synchronous — ~50 call sites
 * depend on that — while making the mirror genuinely complete.
 */
let memorySessions: ChatSession[] | null = null;
/**
 * True only while localStorage has REJECTED a write the memory list holds.
 * Memory outranks storage only then; otherwise storage is read as before, so a
 * second tab or any direct write to the key is never shadowed by a stale cache.
 */
let memoryAhead = false;

/** Test seam: forget the in-memory list so a spec starts from storage. */
export function _resetSessionCache(): void {
  memorySessions = null;
  memoryAhead = false;
}

function readSessionsWithStatus(): { sessions: ChatSession[]; status: ReadStatus } {
  // Memory wins once seeded: it is the only copy guaranteed to include writes
  // that localStorage rejected.
  if (memoryAhead && memorySessions !== null) {
    return { sessions: memorySessions.map(m => m), status: 'ok' };
  }
  let data: string | null;
  try {
    data = localStorage.getItem(SESSIONS_KEY);
  } catch {
    // getItem itself can throw (disabled storage, a hostile polyfill).
    return { sessions: [], status: 'unreadable' };
  }
  if (data == null) return { sessions: [], status: 'absent' };
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return { sessions: [], status: 'unreadable' };
    const sessions = parsed.map(migrate);
    // Seed only from a clean read; an unreadable one must stay recoverable
    // from disk rather than being cached as truth.
    memorySessions = sessions;
    return { sessions: sessions.map(m => m), status: 'ok' };
  } catch {
    return { sessions: [], status: 'unreadable' };
  }
}

/** Marker telling the next boot that localStorage is behind the disk (#600). */
export const SESSIONS_STALE_KEY = 'ollama_gui_sessions_stale';

function markStale(stale: boolean): void {
  try {
    if (stale) localStorage.setItem(SESSIONS_STALE_KEY, '1');
    else localStorage.removeItem(SESSIONS_STALE_KEY);
  } catch { /* even the marker can fail on a full origin — Settings has a manual restore */ }
}

/** True when the last quota failure left localStorage behind the disk copy. */
export function sessionsAreStale(): boolean {
  try { return localStorage.getItem(SESSIONS_STALE_KEY) === '1'; } catch { return false; }
}

/** Whether the last stored sessions value could be read at all (#599). */
export function sessionsReadStatus(): ReadStatus {
  return readSessionsWithStatus().status;
}

/**
 * Mirror to disk unless the read that produced this payload was untrustworthy.
 *
 * 'absent' still mirrors: a fresh install must establish its backup. Only
 * 'unreadable' is withheld, so a corrupt or unreachable localStorage leaves
 * the last good disk copy intact and the failure stays recoverable.
 */
function mirrorSessionsUnlessDegraded(json: string, status: ReadStatus): void {
  if (status === 'unreadable') return;
  mirrorToDisk(DISK_SESSIONS_KEY, json);
}

export const storage = {
  getSessions: (): ChatSession[] => readSessionsWithStatus().sessions,
  saveSession: (session: ChatSession): { ok: true } | { ok: false; error: 'quota' } => {
    const { sessions, status } = readSessionsWithStatus();
    const index = sessions.findIndex(s => s.id === session.id);
    if (index > -1) {
      sessions[index] = session;
    } else {
      sessions.unshift(session);
    }
    // Memory is authoritative from here on, whether or not localStorage takes
    // the write (#600).
    memorySessions = sessions;
    const json = JSON.stringify(sessions);
    let result: { ok: true } | { ok: false; error: 'quota' };
    try {
      localStorage.setItem(SESSIONS_KEY, json);
      memoryAhead = false;
      markStale(false);
      result = { ok: true };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        // localStorage now lags the disk copy; tell the next boot to prefer it.
        memoryAhead = true;
        markStale(true);
        result = { ok: false, error: 'quota' };
      } else {
        result = { ok: true }; // unexpected error — treat as non-fatal
      }
    }
    // Mirror to disk even on the quota path: localStorage may be full, but the
    // Rust store still takes the payload, so no messages are lost while the
    // quota banner is showing. Withheld only when the read was unreadable
    // (#599) — mirroring a rebuilt-from-nothing array would destroy the very
    // backup that can recover the history.
    mirrorSessionsUnlessDegraded(json, status);
    return result;
  },
  /** Merge a partial update into a session (used for pin/archive/tags/folder). */
  updateSession: (id: string, patch: Partial<ChatSession>): void => {
    const { sessions, status } = readSessionsWithStatus();
    const index = sessions.findIndex(s => s.id === id);
    if (index === -1) return;
    sessions[index] = { ...sessions[index], ...patch };
    memorySessions = sessions;
    const json = JSON.stringify(sessions);
    try { localStorage.setItem(SESSIONS_KEY, json); memoryAhead = false; markStale(false); } catch { memoryAhead = true; markStale(true); }
    mirrorSessionsUnlessDegraded(json, status); // disk still takes it on quota
  },
  deleteSession: (id: string) => {
    const { sessions, status } = readSessionsWithStatus();
    const remaining = sessions.filter(s => s.id !== id);
    memorySessions = remaining;
    const json = JSON.stringify(remaining);
    try { localStorage.setItem(SESSIONS_KEY, json); memoryAhead = false; markStale(false); } catch { memoryAhead = true; markStale(true); }
    mirrorSessionsUnlessDegraded(json, status);
  },
  clearAll: () => {
    memorySessions = [];
    memoryAhead = false;
    markStale(false);
    localStorage.removeItem(SESSIONS_KEY);
    // Keep the disk mirror in sync so boot hydration doesn't resurrect
    // deliberately cleared chats.
    mirrorToDisk(DISK_SESSIONS_KEY, '[]');
  },

  // ─── Folders (#133) ──────────────────────────────────────────────────────
  getFolders: (): Folder[] => {
    try {
      const data = localStorage.getItem(FOLDERS_KEY);
      const list: Folder[] = data ? JSON.parse(data) : [];
      return Array.isArray(list) ? list.sort((a, b) => a.order - b.order) : [];
    } catch {
      return [];
    }
  },
  saveFolder: (folder: Folder): void => {
    const folders = storage.getFolders();
    const index = folders.findIndex(f => f.id === folder.id);
    if (index > -1) folders[index] = folder; else folders.push(folder);
    const json = JSON.stringify(folders);
    // Guarded like every other write in this module (#601). Unguarded, a
    // QuotaExceededError threw out of the click handler BEFORE the mirror,
    // so the folder was lost from localStorage and disk alike — and since
    // React error boundaries do not catch event-handler errors, the user saw
    // no crash and no banner, just an action that silently did nothing.
    try { localStorage.setItem(FOLDERS_KEY, json); } catch { /* quota */ }
    mirrorToDisk(DISK_FOLDERS_KEY, json);
  },
  deleteFolder: (id: string): void => {
    const foldersJson = JSON.stringify(storage.getFolders().filter(f => f.id !== id));
    // Detach sessions from the removed folder.
    const sessions = storage.getSessions().map(s => s.folderId === id ? { ...s, folderId: undefined } : s);
    const sessionsJson = JSON.stringify(sessions);
    try {
      localStorage.setItem(FOLDERS_KEY, foldersJson);
      localStorage.setItem(SESSIONS_KEY, sessionsJson);
    } catch { /* quota */ }
    mirrorToDisk(DISK_FOLDERS_KEY, foldersJson);
    mirrorToDisk(DISK_SESSIONS_KEY, sessionsJson);
  },

  // ─── Projects (#92) ────────────────────────────────────────────────────────
  getProjects: (): Project[] => {
    try {
      const data = localStorage.getItem(PROJECTS_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
  saveProject: (project: Project): void => {
    const projects = storage.getProjects();
    const index = projects.findIndex(p => p.id === project.id);
    if (index > -1) projects[index] = project; else projects.unshift(project);
    const json = JSON.stringify(projects);
    // Same guard as saveFolder (#601). This one also carried the worst loss:
    // project instructions the user had just typed were discarded with no
    // feedback at all.
    try { localStorage.setItem(PROJECTS_KEY, json); } catch { /* quota */ }
    mirrorToDisk(DISK_PROJECTS_KEY, json);
  },
  deleteProject: (id: string): void => {
    const projectsJson = JSON.stringify(storage.getProjects().filter(p => p.id !== id));
    // Detach sessions from the deleted project.
    const sessions = storage.getSessions().map(s => s.projectId === id ? { ...s, projectId: undefined } : s);
    const sessionsJson = JSON.stringify(sessions);
    try {
      localStorage.setItem(PROJECTS_KEY, projectsJson);
      localStorage.setItem(SESSIONS_KEY, sessionsJson);
    } catch { /* quota */ }
    mirrorToDisk(DISK_PROJECTS_KEY, projectsJson);
    mirrorToDisk(DISK_SESSIONS_KEY, sessionsJson);
  },
};

/** Combined search across title, tags, folder name, and message content. */
export function searchSessions(sessions: ChatSession[], query: string, folders: Folder[] = []): ChatSession[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  const folderName = (id?: string) => folders.find(f => f.id === id)?.name.toLowerCase() ?? '';
  return sessions.filter(s =>
    s.title.toLowerCase().includes(q) ||
    (s.tags ?? []).some(t => t.toLowerCase().includes(q)) ||
    folderName(s.folderId).includes(q) ||
    s.messages.some(m => m.content.toLowerCase().includes(q))
  );
}

/** Order sessions for the sidebar: pinned first, then by createdAt desc. */
export function orderSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
}

// ─── Conversation-list sort options (#327) ──────────────────────────────────

export type SortMode = 'recent' | 'name' | 'messages';

/**
 * Order sessions by the user-selected sort mode. Pinned sessions always float
 * to the top regardless of the chosen ordering, matching `orderSessions`.
 */
export function sortSessions(sessions: ChatSession[], mode: SortMode): ChatSession[] {
  const pinnedFirst = (a: ChatSession, b: ChatSession) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return 0;
  };
  switch (mode) {
    case 'name':
      return [...sessions].sort((a, b) => {
        const p = pinnedFirst(a, b);
        if (p !== 0) return p;
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      });
    case 'messages':
      return [...sessions].sort((a, b) => {
        const p = pinnedFirst(a, b);
        if (p !== 0) return p;
        return b.messages.length - a.messages.length;
      });
    case 'recent':
    default:
      return orderSessions(sessions);
  }
}

// ─── Conversation import (#232) ───────────────────────────────────────────────

/**
 * Parse and validate an imported conversations JSON string (#232).
 *
 * Extracted from `App.tsx` `handleImportFile` so the error-handling path
 * (invalid JSON / non-array / malformed entries) is unit-testable.
 *
 * @throws {Error} if the text is not valid JSON, is not an array, or contains
 *   an entry that is not a minimally well-formed `ChatSession`.
 */
export function parseSessionImport(text: string): ChatSession[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON');
  }
  // Accept a single session as well as a list (#598). `/save` and
  // `/export json` both write ONE bare session object, so every snapshot and
  // every exported file failed to load with "Expected an array of sessions" —
  // the round-trip was broken in both directions.
  //
  // Fixed in the reader, deliberately, rather than by wrapping the writers:
  // files written by earlier builds are already bare objects, and a
  // writer-only fix would strand every one of them while looking correct.
  const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Session #${i} is not an object`);
    }
    const s = entry as Record<string, unknown>;
    if (typeof s.id !== 'string') throw new Error(`Session #${i} is missing a string id`);
    if (!Array.isArray(s.messages)) throw new Error(`Session #${i} is missing a messages array`);
    return migrate(s);
  });
}
