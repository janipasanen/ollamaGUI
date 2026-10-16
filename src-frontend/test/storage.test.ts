import { describe, it, expect, vi } from 'vitest';
import { storage, parseSessionImport, parseBackupImport } from '../services/storage';

describe('Storage Service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should save and retrieve a session', () => {
    const session = {
      id: '123',
      title: 'Test Chat',
      messages: [{ role: 'user', content: 'Hello' }],
      createdAt: Date.now(),
      model: 'llama3'
    };
    
    storage.saveSession(session);
    const sessions = storage.getSessions();
    // getSessions migrates in default org fields (#133), so match the core shape.
    expect(sessions[0]).toMatchObject(session);
    expect(sessions[0]).toMatchObject({ tags: [], pinned: false, archived: false });
  });

  it('should delete a session', () => {
    const session = {
      id: '123',
      title: 'Test Chat',
      messages: [],
      createdAt: Date.now(),
      model: 'llama3'
    };
    
    storage.saveSession(session);
    storage.deleteSession('123');
    expect(storage.getSessions()).not.toContainEqual(session);
  });
});

// ── parseSessionImport (#232) ──────────────────────────────────────────────────

describe('parseSessionImport (#232)', () => {
  it('returns parsed sessions for a valid JSON array', () => {
    const text = JSON.stringify([
      { id: 'a', title: 'A', messages: [], createdAt: 1, model: 'llama3' },
      { id: 'b', title: 'B', messages: [{ role: 'user', content: 'hi' }], createdAt: 2, model: 'mistral' },
    ]);
    const sessions = parseSessionImport(text);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('a');
    expect(sessions[1].messages).toHaveLength(1);
  });

  it('migrates organization defaults onto imported sessions', () => {
    const text = JSON.stringify([{ id: 'a', title: 'A', messages: [], createdAt: 1, model: 'm' }]);
    const [session] = parseSessionImport(text);
    expect(session.tags).toEqual([]);
    expect(session.pinned).toBe(false);
    expect(session.archived).toBe(false);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseSessionImport('{not valid json')).toThrow();
  });

  it('throws when the parsed value is not an array', () => {
    expect(() => parseSessionImport(JSON.stringify({ id: 'a' }))).toThrow();
    expect(() => parseSessionImport(JSON.stringify('hello'))).toThrow();
  });

  it('throws when an entry is missing a string id', () => {
    const text = JSON.stringify([{ title: 'no id', messages: [], createdAt: 1, model: 'm' }]);
    expect(() => parseSessionImport(text)).toThrow();
  });

  it('throws when an entry is missing a messages array', () => {
    const text = JSON.stringify([{ id: 'a', title: 'A', createdAt: 1, model: 'm' }]);
    expect(() => parseSessionImport(text)).toThrow();
  });

  it('throws when an entry is not an object', () => {
    const text = JSON.stringify(['not-a-session']);
    expect(() => parseSessionImport(text)).toThrow();
  });
});


// ── #454: corrupted localStorage must not crash ─────────────────────────────

describe('storage corrupted localStorage (#454)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('getSessions returns [] when localStorage data is corrupted', () => {
    localStorage.setItem('ollama_gui_sessions', '{not valid json');
    expect(storage.getSessions()).toEqual([]);
  });

  it('getSessions returns [] when localStorage data is not an array', () => {
    localStorage.setItem('ollama_gui_sessions', '"a string"');
    expect(storage.getSessions()).toEqual([]);
  });

  it('getFolders returns [] when localStorage data is corrupted', () => {
    localStorage.setItem('ollama_gui_folders', '{not valid json');
    expect(storage.getFolders()).toEqual([]);
  });

  it('getProjects returns [] when localStorage data is corrupted', () => {
    localStorage.setItem('ollama_gui_projects', '{not valid json');
    expect(storage.getProjects()).toEqual([]);
  });

  it('getProjects returns [] when localStorage data is not an array', () => {
    localStorage.setItem('ollama_gui_projects', '42');
    expect(storage.getProjects()).toEqual([]);
  });

  it('updateSession does not throw when localStorage is full', () => {
    const session = {
      id: 's1', title: 'Test', messages: [], createdAt: 1, model: 'm',
    };
    storage.saveSession(session);
    // Simulate quota exceeded
    const origSetItem = localStorage.setItem.bind(localStorage);
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => storage.updateSession('s1', { title: 'Updated' })).not.toThrow();
    spy.mockRestore();
  });

  it('deleteSession does not throw when localStorage is full', () => {
    const session = {
      id: 's1', title: 'Test', messages: [], createdAt: 1, model: 'm',
    };
    storage.saveSession(session);
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => storage.deleteSession('s1')).not.toThrow();
    spy.mockRestore();
  });

  it('saveFolder does not throw when localStorage is full (#595)', () => {
    storage.saveFolder({ id: 'f1', name: 'F', order: 0 });
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => storage.saveFolder({ id: 'f1', name: 'F', order: 0 })).not.toThrow();
    spy.mockRestore();
  });

  it('saveProject does not throw when localStorage is full (#595)', () => {
    storage.saveProject({ id: 'p1', name: 'P', workspaceRoot: '', instructions: '', createdAt: 1 });
    const origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    try {
      expect(() => storage.saveProject({ id: 'p1', name: 'P', workspaceRoot: '', instructions: '', createdAt: 1 })).not.toThrow();
      // On quota the write is swallowed and reports the shape (#604).
      expect(storage.saveProject({ id: 'p1', name: 'P', workspaceRoot: '', instructions: '', createdAt: 1 })).toEqual({ ok: false, error: 'quota' });
    } finally {
      Storage.prototype.setItem = origSetItem;
    }
  });

  it('saveFolder reports {ok:true} on a successful write', () => {
    expect(storage.saveFolder({ id: 'f1', name: 'F', order: 0 })).toEqual({ ok: true });
  });
});


// ── #604: whole-store backup (sessions + folders + projects) ─────────────────

describe('exportBackup / parseBackupImport (#604)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exportBackup captures sessions, folders, and projects together', () => {
    storage.saveFolder({ id: 'f1', name: 'Docs', order: 0 });
    storage.saveProject({ id: 'p1', name: 'P', workspaceRoot: '/w', instructions: 'sys', createdAt: 1 });
    storage.saveSession({ id: 's1', title: 'S', messages: [], createdAt: 1, model: 'm', projectId: 'p1', folderId: 'f1' });
    const env = storage.exportBackup();
    expect(env.version).toBe(1);
    expect(env.folders).toHaveLength(1);
    expect(env.projects).toHaveLength(1);
    expect(env.sessions).toHaveLength(1);
  });

  it('round-trips through exportBackup → parseBackupImport', () => {
    storage.saveFolder({ id: 'f1', name: 'Docs', order: 0 });
    storage.saveProject({ id: 'p1', name: 'P', workspaceRoot: '/w', instructions: 'sys', createdAt: 1 });
    storage.saveSession({ id: 's1', title: 'S', messages: [], createdAt: 1, model: 'm', projectId: 'p1' });
    const env = storage.exportBackup();
    const parsed = parseBackupImport(JSON.stringify(env));
    expect(parsed.folders).toHaveLength(1);
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].projectId).toBe('p1');
  });

  it('parseBackupImport accepts a bare legacy session array', () => {
    const env = parseBackupImport(JSON.stringify([
      { id: 'a', title: 'A', messages: [], createdAt: 1, model: 'm' },
    ]));
    expect(env.sessions).toHaveLength(1);
    expect(env.folders).toEqual([]);
    expect(env.projects).toEqual([]);
  });

  it('parseBackupImport migrates organization defaults onto imported sessions', () => {
    const env = parseBackupImport(JSON.stringify([{ id: 'a', title: 'A', messages: [], createdAt: 1, model: 'm' }]));
    expect(env.sessions[0].tags).toEqual([]);
    expect(env.sessions[0].pinned).toBe(false);
    expect(env.sessions[0].archived).toBe(false);
  });

  it('parseBackupImport throws on invalid JSON', () => {
    expect(() => parseBackupImport('{not valid json')).toThrow();
  });

  it('parseBackupImport throws on a non-envelope, non-array value', () => {
    expect(() => parseBackupImport('42')).toThrow();
    expect(() => parseBackupImport(JSON.stringify({ foo: 'bar' }))).toThrow();
  });

  it('parseBackupImport rejects malformed sessions inside the envelope', () => {
    expect(() => parseBackupImport(JSON.stringify({ sessions: [{ id: 'a', createdAt: 1 }] }))).toThrow();
  });
});


// ── #604: atomic batch import (#604) ──────────────────────────────────────

describe('importSessions (#604)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('merges by id in a single localStorage write', () => {
    storage.saveSession({ id: 's1', title: 'Old', messages: [], createdAt: 1, model: 'm' });
    const origSetItem = Storage.prototype.setItem;
    const calls = { count: 0 };
    Storage.prototype.setItem = (...args) => {
      calls.count++;
      return origSetItem.apply(localStorage, args);
    };
    try {
      const result = storage.importSessions([
        { id: 's1', title: 'New', messages: [], createdAt: 2, model: 'm' },
        { id: 's2', title: 'Added', messages: [], createdAt: 3, model: 'm' },
      ]);
      // One merged write, not one-per-session (no quadratic re-serialize).
      expect(calls.count).toBe(1);
      expect(result).toEqual({ total: 2, saved: 2, quota: false });
      const ids = storage.getSessions().map(s => s.id).sort();
      expect(ids).toEqual(['s1', 's2']);
      expect(storage.getSessions().find(s => s.id === 's1')?.title).toBe('New');
    } finally {
      Storage.prototype.setItem = origSetItem;
    }
  });

  it('reports quota and persists nothing when the store is full', () => {
    const origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    try {
      const result = storage.importSessions([
        { id: 's1', title: 'A', messages: [], createdAt: 1, model: 'm' },
        { id: 's2', title: 'B', messages: [], createdAt: 2, model: 'm' },
      ]);
      expect(result).toEqual({ total: 2, saved: 0, quota: true });
      // Nothing persisted — the original store is untouched.
      expect(storage.getSessions()).toHaveLength(0);
    } finally {
      Storage.prototype.setItem = origSetItem;
    }
  });
});
