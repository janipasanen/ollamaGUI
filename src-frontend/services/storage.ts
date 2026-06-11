import { Message } from './ollama';

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
}

export interface Folder {
  id: string;
  name: string;
  order: number;
}

const SESSIONS_KEY = 'ollama_gui_sessions';
const FOLDERS_KEY = 'ollama_gui_folders';

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
    const data = localStorage.getItem(SESSIONS_KEY);
    return data ? (JSON.parse(data) as any[]).map(migrate) : [];
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
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  },
  deleteSession: (id: string) => {
    const sessions = storage.getSessions().filter(s => s.id !== id);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  },
  clearAll: () => {
    localStorage.removeItem(SESSIONS_KEY);
  },

  // ─── Folders (#133) ──────────────────────────────────────────────────────
  getFolders: (): Folder[] => {
    const data = localStorage.getItem(FOLDERS_KEY);
    const list: Folder[] = data ? JSON.parse(data) : [];
    return list.sort((a, b) => a.order - b.order);
  },
  saveFolder: (folder: Folder): void => {
    const folders = storage.getFolders();
    const index = folders.findIndex(f => f.id === folder.id);
    if (index > -1) folders[index] = folder; else folders.push(folder);
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  },
  deleteFolder: (id: string): void => {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(storage.getFolders().filter(f => f.id !== id)));
    // Detach sessions from the removed folder.
    const sessions = storage.getSessions().map(s => s.folderId === id ? { ...s, folderId: undefined } : s);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
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
