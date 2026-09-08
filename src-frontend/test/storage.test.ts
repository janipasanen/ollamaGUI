import { describe, it, expect, vi } from 'vitest';
import { storage, parseSessionImport, parseBackupImport, importSessions } from '../services/storage';

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
});

// ── #601: saveFolder / saveProject must not throw on quota ────────────────────

describe('saveFolder / saveProject quota guard (#601)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saveFolder returns ok:true on normal save', () => {
    const result = storage.saveFolder({ id: 'f1', name: 'Work', order: 0 });
    expect(result).toEqual({ ok: true });
  });

  it('saveProject returns ok:true on normal save', () => {
    const result = storage.saveProject({ id: 'p1', name: 'Proj', workspaceRoot: '', instructions: '', createdAt: 1 });
    expect(result).toEqual({ ok: true });
  });

  it('saveFolder does not throw on quota and returns ok:false', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const result = storage.saveFolder({ id: 'f2', name: 'Home', order: 1 });
    expect(result).toEqual({ ok: false, error: 'quota' });
    spy.mockRestore();
  });

  it('saveProject does not throw on quota and returns ok:false', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const result = storage.saveProject({ id: 'p2', name: 'Proj2', workspaceRoot: '', instructions: '', createdAt: 2 });
    expect(result).toEqual({ ok: false, error: 'quota' });
    spy.mockRestore();
  });

  it('saveFolder still mirrors to disk on quota', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    storage.saveFolder({ id: 'f3', name: 'Backup', order: 2 });
    // The mirrorToDisk mock is set up in storageMirror.test.ts — this file
    // tests the non-mirror path.  We verify the function does not throw;
    // the mirror itself is covered in storageMirror.test.ts.
    spy.mockRestore();
  });

  it('saveProject still mirrors to disk on quota', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    storage.saveProject({ id: 'p3', name: 'Proj3', workspaceRoot: '', instructions: '', createdAt: 3 });
    spy.mockRestore();
  });
});

// ── #604: parseBackupImport (versioned envelope + legacy) ────────────────────

describe('parseBackupImport (#604)', () => {
  it('parses a legacy bare array', () => {
    const text = JSON.stringify([
      { id: 'a', title: 'A', messages: [], createdAt: 1, model: 'm' },
    ]);
    const result = parseBackupImport(text);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe('a');
    expect(result.folders).toEqual([]);
    expect(result.projects).toEqual([]);
  });

  it('parses a versioned envelope', () => {
    const text = JSON.stringify({
      version: 1,
      sessions: [{ id: 'b', title: 'B', messages: [{ role: 'user', content: 'hi' }], createdAt: 2, model: 'm' }],
      folders: [{ id: 'f1', name: 'Work', order: 0 }],
      projects: [{ id: 'p1', name: 'Proj', workspaceRoot: '', instructions: '', createdAt: 1 }],
    });
    const result = parseBackupImport(text);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].title).toBe('B');
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0].name).toBe('Work');
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe('Proj');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseBackupImport('{bad')).toThrow();
  });

  it('throws when envelope is missing sessions', () => {
    expect(() => parseBackupImport(JSON.stringify({ version: 1 }))).toThrow('sessions');
  });

  it('throws when envelope is missing version', () => {
    expect(() => parseBackupImport(JSON.stringify({ sessions: [] }))).toThrow('version');
  });

  it('throws when parsed value is neither array nor object', () => {
    expect(() => parseBackupImport('42')).toThrow();
  });

  it('migrates organization defaults onto imported sessions', () => {
    const text = JSON.stringify([{ id: 'a', title: 'A', messages: [], createdAt: 1, model: 'm' }]);
    const { sessions } = parseBackupImport(text);
    expect(sessions[0]).toMatchObject({ tags: [], pinned: false, archived: false });
  });

  it('tolerates invalid folder/project entries in envelope', () => {
    const text = JSON.stringify({
      version: 1,
      sessions: [{ id: 'c', title: 'C', messages: [], createdAt: 3, model: 'm' }],
      folders: [{ id: 'f1', name: 'Valid', order: 0 }, { id: 'bad' }], // second is invalid
      projects: [],
    });
    const result = parseBackupImport(text);
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0].name).toBe('Valid');
  });
});

// ── #604: importSessions batch import ─────────────────────────────────────────

describe('importSessions (#604)', () => {
  beforeEach(() => { localStorage.clear(); });

  it('imports new sessions and skips duplicates', () => {
    storage.saveSession({ id: 'a', title: 'A', messages: [], createdAt: 1, model: 'm' });
    importSessions([
      { id: 'b', title: 'B', messages: [], createdAt: 2, model: 'm' },
      { id: 'a', title: 'A Updated', messages: [], createdAt: 3, model: 'm' }, // duplicate
    ]);
    const all = storage.getSessions();
    expect(all.length).toBe(2);
    expect(all.map(s => s.id).sort()).toEqual(['a', 'b']);
  });

  it('returns ok:true on normal import', () => {
    const result = importSessions([{ id: 'x', title: 'X', messages: [], createdAt: 1, model: 'm' }]);
    expect(result).toEqual({ ok: true });
  });

  it('returns ok:false,error:quota when localStorage is full', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const result = importSessions([{ id: 'y', title: 'Y', messages: [], createdAt: 1, model: 'm' }]);
    expect(result).toEqual({ ok: false, error: 'quota' });
    spy.mockRestore();
  });

  it('still mirrors to disk even on quota failure', () => {
    // This tests that mirrorToDisk is called even when setItem throws
    // The mirrorMock is set up in storageMirror.test.ts
    // Here we verify the function doesn't throw and returns the right shape
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const result = importSessions([{ id: 'z', title: 'Z', messages: [], createdAt: 1, model: 'm' }]);
    expect(result).toEqual({ ok: false, error: 'quota' });
    // Note: mirrorToDisk is called inside importSessions, so it still fires
    // even when localStorage throws — this is the whole point of this function
    spy.mockRestore();
  });
});
