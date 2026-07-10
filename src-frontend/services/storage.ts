import { Message } from './ollama';
import type { BranchState } from './branching';

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
}

// ─── Projects (#92) ───────────────────────────────────────────────────────────
export interface Project {
  id: string;
  name: string;
  /** Absolute path to the workspace root (may be empty string when not yet set). */
  workspaceRoot: string;
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
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
      return { ok: true };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        return { ok: false, error: 'quota' };
      }
      return { ok: true }; // unexpected error — treat as non-fatal
    }
  },
  /** Merge a partial update into a session (used for pin/archive/tags/folder). */
  updateSession: (id: string, patch: Partial<ChatSession>): void => {
    const sessions = storage.getSessions();
    const index = sessions.findIndex(s => s.id === id);
    if (index === -1) return;
    sessions[index] = { ...sessions[index], ...patch };
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); } catch { /* quota */ }
  },
  deleteSession: (id: string) => {
    const sessions = storage.getSessions().filter(s => s.id !== id);
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); } catch { /* quota */ }
  },
  clearAll: () => {
    localStorage.removeItem(SESSIONS_KEY);
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
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  },
  deleteFolder: (id: string): void => {
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(storage.getFolders().filter(f => f.id !== id)));
      // Detach sessions from the removed folder.
      const sessions = storage.getSessions().map(s => s.folderId === id ? { ...s, folderId: undefined } : s);
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch { /* quota */ }
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
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  },
  deleteProject: (id: string): void => {
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(storage.getProjects().filter(p => p.id !== id)));
      // Detach sessions from the deleted project.
      const sessions = storage.getSessions().map(s => s.projectId === id ? { ...s, projectId: undefined } : s);
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch { /* quota */ }
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
