import { Message } from './ollama';

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  model: string;
}

export const storage = {
  getSessions: (): ChatSession[] => {
    const data = localStorage.getItem('ollama_gui_sessions');
    return data ? JSON.parse(data) : [];
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
      localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
      return { ok: true };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        return { ok: false, error: 'quota' };
      }
      return { ok: true }; // unexpected error — treat as non-fatal
    }
  },
  deleteSession: (id: string) => {
    const sessions = storage.getSessions().filter(s => s.id !== id);
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
  },
  clearAll: () => {
    localStorage.removeItem('ollama_gui_sessions');
  }
};
