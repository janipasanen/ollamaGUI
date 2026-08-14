// storage.ts write-through mirror: every sessions/projects/folders save must
// also be handed to rustStore.mirrorToDisk — including the quota path, where
// localStorage is full but the disk can still take the payload.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mirrorMock } = vi.hoisted(() => ({ mirrorMock: vi.fn() }));
vi.mock('../services/rustStore', () => ({
  mirrorToDisk: mirrorMock,
  loadFromDisk: vi.fn().mockResolvedValue(null),
  _clearPendingMirrors: vi.fn(),
}));

import { storage } from '../services/storage';

const session = (id: string, title = 'Chat') => ({
  id, title, messages: [], createdAt: 1, model: 'llama3',
});

describe('storage disk mirror', () => {
  beforeEach(() => {
    localStorage.clear();
    mirrorMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mirrors the sessions payload on saveSession', () => {
    expect(storage.saveSession(session('s1'))).toEqual({ ok: true });
    expect(mirrorMock).toHaveBeenCalledTimes(1);
    const [key, json] = mirrorMock.mock.calls[0];
    expect(key).toBe('sessions');
    expect(json).toBe(localStorage.getItem('ollama_gui_sessions'));
    expect(JSON.parse(json)[0].id).toBe('s1');
  });

  it('mirrors on updateSession and deleteSession', () => {
    storage.saveSession(session('s1'));
    mirrorMock.mockClear();

    storage.updateSession('s1', { pinned: true });
    expect(mirrorMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mirrorMock.mock.calls[0][1])[0].pinned).toBe(true);

    storage.deleteSession('s1');
    expect(mirrorMock).toHaveBeenLastCalledWith('sessions', '[]');
  });

  it('mirrors folders and projects on their save/delete paths', () => {
    storage.saveFolder({ id: 'f1', name: 'Work', order: 0 });
    expect(mirrorMock).toHaveBeenLastCalledWith('folders', localStorage.getItem('ollama_gui_folders'));

    storage.saveProject({ id: 'p1', name: 'Proj', workspaceRoot: '', instructions: '', createdAt: 1 });
    expect(mirrorMock).toHaveBeenLastCalledWith('projects', localStorage.getItem('ollama_gui_projects'));

    mirrorMock.mockClear();
    storage.deleteProject('p1');
    // deleteProject rewrites projects AND sessions (detach) — both mirrored.
    const keys = mirrorMock.mock.calls.map(c => c[0]).sort();
    expect(keys).toEqual(['projects', 'sessions']);

    mirrorMock.mockClear();
    storage.deleteFolder('f1');
    const keys2 = mirrorMock.mock.calls.map(c => c[0]).sort();
    expect(keys2).toEqual(['folders', 'sessions']);
  });

  it('STILL mirrors the new payload when localStorage hits its quota', () => {
    storage.saveSession(session('s1', 'kept'));
    mirrorMock.mockClear();

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    const result = storage.saveSession(session('s2', 'quota-bound chat'));
    // The UI contract is unchanged: caller still sees the quota error…
    expect(result).toEqual({ ok: false, error: 'quota' });
    // …but the payload (including the NEW session) reached the disk mirror.
    expect(mirrorMock).toHaveBeenCalledTimes(1);
    const [key, json] = mirrorMock.mock.calls[0];
    expect(key).toBe('sessions');
    expect(JSON.parse(json).map((s: { id: string }) => s.id)).toContain('s2');

    setItem.mockRestore();
  });

  it('mirrors an empty list on clearAll so hydration cannot resurrect cleared chats', () => {
    storage.saveSession(session('s1'));
    mirrorMock.mockClear();
    storage.clearAll();
    expect(mirrorMock).toHaveBeenCalledWith('sessions', '[]');
  });
});
