import { describe, it, expect, beforeEach } from 'vitest';
import { storage, searchSessions, orderSessions, ChatSession, Folder } from '../services/storage';

const session = (over: Partial<ChatSession> = {}): ChatSession => ({
  id: 'a', title: 'Chat A', messages: [], createdAt: 1, model: 'm', ...over,
});

describe('chat organization (#133)', () => {
  beforeEach(() => localStorage.clear());

  it('migrates legacy sessions with default org fields', () => {
    // A legacy session blob lacking tags/pinned/archived.
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([{ id: 'x', title: 'Old', messages: [], createdAt: 1, model: 'm' }]));
    const [s] = storage.getSessions();
    expect(s.tags).toEqual([]);
    expect(s.pinned).toBe(false);
    expect(s.archived).toBe(false);
  });

  it('updateSession persists pin / archive / tags / folder mutations', () => {
    storage.saveSession(session({ id: 'a' }));
    storage.updateSession('a', { pinned: true, archived: true, tags: ['work', 'urgent'], folderId: 'f1' });
    const s = storage.getSessions().find(x => x.id === 'a')!;
    expect(s.pinned).toBe(true);
    expect(s.archived).toBe(true);
    expect(s.tags).toEqual(['work', 'urgent']);
    expect(s.folderId).toBe('f1');
  });

  it('folder CRUD persists and detaches sessions on delete', () => {
    const f: Folder = { id: 'f1', name: 'Projects', order: 0 };
    storage.saveFolder(f);
    expect(storage.getFolders()).toHaveLength(1);
    storage.saveFolder({ id: 'f1', name: 'Renamed', order: 0 });
    expect(storage.getFolders()[0].name).toBe('Renamed');

    storage.saveSession(session({ id: 'a', folderId: 'f1' }));
    storage.deleteFolder('f1');
    expect(storage.getFolders()).toHaveLength(0);
    expect(storage.getSessions().find(s => s.id === 'a')!.folderId).toBeUndefined();
  });

  it('searchSessions matches title, tags, folder name, and content', () => {
    const sessions: ChatSession[] = [
      session({ id: '1', title: 'Budget', tags: [] }),
      session({ id: '2', title: 'Misc', tags: ['finance'] }),
      session({ id: '3', title: 'Notes', folderId: 'f1' }),
      session({ id: '4', title: 'Other', messages: [{ role: 'user', content: 'quarterly revenue' }] }),
    ];
    const folders: Folder[] = [{ id: 'f1', name: 'Accounting', order: 0 }];
    expect(searchSessions(sessions, 'budget', folders).map(s => s.id)).toEqual(['1']);
    expect(searchSessions(sessions, 'finance', folders).map(s => s.id)).toEqual(['2']);
    expect(searchSessions(sessions, 'accounting', folders).map(s => s.id)).toEqual(['3']);
    expect(searchSessions(sessions, 'revenue', folders).map(s => s.id)).toEqual(['4']);
    expect(searchSessions(sessions, '', folders)).toHaveLength(4);
  });

  it('orderSessions puts pinned first then newest', () => {
    const sessions: ChatSession[] = [
      session({ id: 'old', createdAt: 1 }),
      session({ id: 'new', createdAt: 5 }),
      session({ id: 'pin', createdAt: 2, pinned: true }),
    ];
    expect(orderSessions(sessions).map(s => s.id)).toEqual(['pin', 'new', 'old']);
  });
});
