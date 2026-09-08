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
  // Per-Message Provider Selection (G3): the connection this conversation was
  // created with, so a session can keep its provider even after the app-global
  // default model/connection changes (#123/#318). Unset = app default.
  connectionId?: string;
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

export const storage = {
  getSessions: (): ChatSession[] => {
    try {
      const data = localStorage.getItem(SESSIONS_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed.map(migrate) : [];
    } catch {
      return [];
    }
  },
  saveSession: (session: ChatSession): { ok: true } | { ok: false; error: 'quota' } => {
    const sessions = storage.getSessions();
    const index = sessions.findIndex(s => s.id === session.id);
    if (index > -1) {
      sessions[index] = session;
    } else {
      sessions.unshift(session);
    }
    const json = JSON.stringify(sessions);
    let result: { ok: true } | { ok: false; error: 'quota' };
    try {
      localStorage.setItem(SESSIONS_KEY, json);
      result = { ok: true };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        result = { ok: false, error: 'quota' };
      } else {
        result = { ok: true }; // unexpected error — treat as non-fatal
      }
    }
    // Mirror to disk even on the quota path: localStorage may be full, but the
    // Rust store still takes the payload, so no messages are lost while the
    // quota banner is showing.
    mirrorToDisk(DISK_SESSIONS_KEY, json);
    return result;
  },
  /** Merge a partial update into a session (used for pin/archive/tags/folder). */
  updateSession: (id: string, patch: Partial<ChatSession>): void => {
    const sessions = storage.getSessions();
    const index = sessions.findIndex(s => s.id === id);
    if (index === -1) return;
    sessions[index] = { ...sessions[index], ...patch };
    const json = JSON.stringify(sessions);
    try { localStorage.setItem(SESSIONS_KEY, json); } catch { /* quota */ }
    mirrorToDisk(DISK_SESSIONS_KEY, json); // disk still takes it on quota
  },
  deleteSession: (id: string) => {
    const sessions = storage.getSessions().filter(s => s.id !== id);
    const json = JSON.stringify(sessions);
    try { localStorage.setItem(SESSIONS_KEY, json); } catch { /* quota */ }
    mirrorToDisk(DISK_SESSIONS_KEY, json);
  },
  clearAll: () => {
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
  saveFolder: (folder: Folder): { ok: true } | { ok: false; error: 'quota' } => {
    const folders = storage.getFolders();
    const index = folders.findIndex(f => f.id === folder.id);
    if (index > -1) folders[index] = folder; else folders.push(folder);
    const json = JSON.stringify(folders);
    let result: { ok: true } | { ok: false; error: 'quota' };
    try {
      localStorage.setItem(FOLDERS_KEY, json);
      result = { ok: true };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        result = { ok: false, error: 'quota' };
      } else {
        result = { ok: true }; // unexpected error — treat as non-fatal
      }
    }
    // Mirror to disk even on the quota path so the folder is not lost.
    mirrorToDisk(DISK_FOLDERS_KEY, json);
    return result;
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
  saveProject: (project: Project): { ok: true } | { ok: false; error: 'quota' } => {
    const projects = storage.getProjects();
    const index = projects.findIndex(p => p.id === project.id);
    if (index > -1) projects[index] = project; else projects.unshift(project);
    const json = JSON.stringify(projects);
    let result: { ok: true } | { ok: false; error: 'quota' };
    try {
      localStorage.setItem(PROJECTS_KEY, json);
      result = { ok: true };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        result = { ok: false, error: 'quota' };
      } else {
        result = { ok: true }; // unexpected error — treat as non-fatal
      }
    }
    // Mirror to disk even on the quota path so the project is not lost.
    mirrorToDisk(DISK_PROJECTS_KEY, json);
    return result;
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
  if (!Array.isArray(parsed)) {
    throw new Error('Expected an array of sessions');
  }
  return parsed.map((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Session #${i} is not an object`);
    }
    const s = entry as Record<string, unknown>;
    if (typeof s.id !== 'string') throw new Error(`Session #${i} is missing a string id`);
    if (!Array.isArray(s.messages)) throw new Error(`Session #${i} is missing a messages array`);
    return migrate(s);
  });
}

// ─── Backup envelope (#604) ─────────────────────────────────────────────────

/**
 * Import envelope types for versioned backups (#604).
 */
export interface BackupEnvelope {
  version: number;
  sessions: Record<string, unknown>[];
  folders?: Folder[];
  projects?: Project[];
}

/**
 * Parse a backup file — accepts both the new versioned envelope { version, sessions, ... }
 * and a legacy bare array of sessions.  Returns a fully typed envelope; legacy arrays
 * are mapped to { sessions, folders: [], projects: [] }.
 *
 * @throws {Error} if the text is not valid JSON, or if the envelope is missing the
 *   sessions key (for versioned format).
 */
export function parseBackupImport(text: string): { sessions: ChatSession[]; folders: Folder[]; projects: Project[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON');
  }

  // Legacy: bare array of sessions
  if (Array.isArray(parsed)) {
    const sessions = parsed.map((entry, i) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`Session #${i} is not an object`);
      }
      const s = entry as Record<string, unknown>;
      if (typeof s.id !== 'string') throw new Error(`Session #${i} is missing a string id`);
      if (!Array.isArray(s.messages)) throw new Error(`Session #${i} is missing a messages array`);
      return migrate(s);
    });
    return { sessions, folders: [], projects: [] };
  }

  // Versioned envelope: must have sessions and a numeric version
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Expected an object with sessions array');
  }
  const env = parsed as Record<string, unknown>;
  if (!Array.isArray(env.sessions)) {
    throw new Error('Missing "sessions" key in backup');
  }
  if (typeof env.version !== 'number') {
    throw new Error('Missing "version" in backup envelope');
  }

  const sessions = env.sessions.map((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Session #${i} is not an object`);
    }
    const s = entry as Record<string, unknown>;
    if (typeof s.id !== 'string') throw new Error(`Session #${i} is missing a string id`);
    if (!Array.isArray(s.messages)) throw new Error(`Session #${i} is missing a messages array`);
    return migrate(s);
  });

  // Folders: pass through as-is if valid array
  const folders: Folder[] = (env.folders && Array.isArray(env.folders))
    ? env.folders.filter((f: unknown): f is Folder => f !== null && f !== undefined && typeof f === 'object' && 'id' in f && 'name' in f)
    : [];

  // Projects: pass through as-is if valid array
  const projects: Project[] = (env.projects && Array.isArray(env.projects))
    ? env.projects.filter((p: unknown): p is Project => p !== null && p !== undefined && typeof p === 'object' && 'id' in p && 'name' in p && 'workspaceRoot' in p)
    : [];

  return { sessions, folders, projects };
}

/**
 * Batch-import sessions: merge by id, do ONE setItem + ONE mirrorToDisk.
 * Returns { ok: true } or { ok: false, error: 'quota' } to let callers
 * report accurately whether all writes succeeded.
 *
 * This replaces the quadratic `forEach(s => saveSession(s))` pattern
 * with a single JSON write, and is used by both the file import dialog
 * and the /load command.  The caller remains responsible for calling
 * `setSessions(storage.getSessions())` to update React state after success.
 */
export function importSessions(sessions: ChatSession[]): { ok: true } | { ok: false; error: 'quota' } {
  const existing = storage.getSessions();
  const existingIds = new Set(existing.map(s => s.id));
  // Only add new sessions (skip duplicates by id)
  const merged = [...existing];
  for (const s of sessions) {
    if (!existingIds.has(s.id)) {
      merged.unshift(s);
    }
  }
  const json = JSON.stringify(merged);
  let result: { ok: true } | { ok: false; error: 'quota' };
  try {
    localStorage.setItem(SESSIONS_KEY, json);
    result = { ok: true };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      result = { ok: false, error: 'quota' };
    } else {
      result = { ok: true }; // unexpected error — treat as non-fatal
    }
  }
  mirrorToDisk(DISK_SESSIONS_KEY, json);
  return result;
}
