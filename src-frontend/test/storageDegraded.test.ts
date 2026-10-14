// @vitest-environment node
/**
 * A degraded localStorage read must never be mirrored to disk as authoritative
 * (#599), and folder/project writes must survive a quota error (#601).
 *
 * The failure these guard against is total: one bad value used to read as "no
 * sessions", and the next save rebuilt the array from nothing and wrote that
 * over the disk backup — destroying the durable copy in precisely the case it
 * exists to cover.
 *
 * Node environment with a localStorage stub: nothing here touches the DOM, and
 * jsdom's setup alone can exceed vitest's fixed worker-start timeout on this
 * machine.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mirrored: Array<{ key: string; json: string }> = [];
vi.mock('../services/rustStore', () => ({
  mirrorToDisk: (key: string, json: string) => { mirrored.push({ key, json }); },
  loadFromDisk: async () => null,
  clearDisk: async () => true,
}));

class MemoryStorage {
  m = new Map<string, string>();
  throwOnSet = false;
  throwOnGet = false;
  /** Refuse even tiny writes — a completely exhausted origin. */
  hardFull = false;
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) {
    if (this.throwOnGet) throw new Error('storage disabled');
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    // Real quota failures are size-dependent: a browser rejects a multi-MB
    // session payload while still accepting a 1-byte marker. A stub that
    // refuses everything would make the stale marker untestable and would not
    // match what users hit.
    if (this.throwOnSet && (this.hardFull || String(v).length > 16)) {
      throw new DOMException('quota', 'QuotaExceededError');
    }
    this.m.set(k, String(v));
  }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  (globalThis as any).localStorage = store;
  (globalThis as any).DOMException = (globalThis as any).DOMException ?? class extends Error {
    constructor(msg: string, public name: string) { super(msg); }
  };
  mirrored.length = 0;
});

const session = (id: string) => ({ id, title: id, messages: [], createdAt: 1, model: 'm' });

async function fresh() {
  vi.resetModules();
  const mod = await import('../services/storage');
  // The in-memory list survives module state; clear it so each spec starts
  // from whatever localStorage holds.
  mod._resetSessionCache();
  return mod;
}

describe('a corrupt read is never mirrored over the backup (#599)', () => {
  it('reports the read as unreadable rather than empty', async () => {
    const { sessionsReadStatus, storage } = await fresh();
    store.m.set('ollama_gui_sessions', '{ this is not json');
    expect(sessionsReadStatus()).toBe('unreadable');
    // getSessions still returns an array so its ~50 call sites are unchanged.
    expect(storage.getSessions()).toEqual([]);
  });

  it('does not mirror when saving on top of a corrupt read', async () => {
    const { storage } = await fresh();
    store.m.set('ollama_gui_sessions', 'garbage');
    storage.saveSession(session('a') as any);
    // The disk copy is the only surviving record of the real history.
    expect(mirrored.filter(m => m.key === 'sessions')).toHaveLength(0);
  });

  it('does not mirror on delete or update after a corrupt read', async () => {
    const { storage } = await fresh();
    store.m.set('ollama_gui_sessions', '"a string, not an array"');
    storage.deleteSession('a');
    storage.updateSession('a', { pinned: true });
    expect(mirrored.filter(m => m.key === 'sessions')).toHaveLength(0);
  });

  it('treats a non-array value as unreadable, not as empty', async () => {
    const { sessionsReadStatus } = await fresh();
    store.m.set('ollama_gui_sessions', '{"not":"an array"}');
    expect(sessionsReadStatus()).toBe('unreadable');
  });

  it('treats a throwing getItem as unreadable', async () => {
    const { sessionsReadStatus } = await fresh();
    store.throwOnGet = true;
    expect(sessionsReadStatus()).toBe('unreadable');
  });

  it('STILL mirrors on a genuinely fresh install', async () => {
    // 'absent' must not be conflated with 'unreadable': a new install has to
    // establish its backup, or the durable store never gets a first copy.
    const { storage, sessionsReadStatus } = await fresh();
    expect(sessionsReadStatus()).toBe('absent');
    storage.saveSession(session('a') as any);
    expect(mirrored.filter(m => m.key === 'sessions')).toHaveLength(1);
  });

  it('still mirrors on the quota path, which is the documented behaviour', async () => {
    const { storage } = await fresh();
    storage.saveSession(session('a') as any);
    mirrored.length = 0;
    store.throwOnSet = true;
    const res = storage.saveSession(session('b') as any);
    expect(res).toEqual({ ok: false, error: 'quota' });
    // localStorage is full but the Rust store still takes it, so nothing is
    // lost while the quota banner shows.
    expect(mirrored.filter(m => m.key === 'sessions')).toHaveLength(1);
  });

  it('mirrors normally when the read is clean', async () => {
    const { storage } = await fresh();
    store.m.set('ollama_gui_sessions', JSON.stringify([session('a')]));
    storage.saveSession(session('b') as any);
    const last = mirrored.filter(m => m.key === 'sessions').at(-1)!;
    expect(JSON.parse(last.json)).toHaveLength(2);
  });
});

describe('folder and project writes survive a quota error (#601)', () => {
  it('saveFolder still reaches the disk mirror when localStorage is full', async () => {
    const { storage } = await fresh();
    store.throwOnSet = true;
    // Previously this threw out of the click handler before the mirror, so the
    // folder vanished from localStorage AND disk, with no error surfaced —
    // React error boundaries do not catch event-handler throws.
    expect(() => storage.saveFolder({ id: 'f1', name: 'Work', order: 0 })).not.toThrow();
    expect(mirrored.filter(m => m.key === 'folders')).toHaveLength(1);
  });

  it('saveProject still reaches the disk mirror when localStorage is full', async () => {
    const { storage } = await fresh();
    store.throwOnSet = true;
    expect(() => storage.saveProject({
      id: 'p1', name: 'App', workspaceRoot: '/x', instructions: 'Be careful', createdAt: 1,
    } as any)).not.toThrow();
    const rows = mirrored.filter(m => m.key === 'projects');
    expect(rows).toHaveLength(1);
    // The instructions the user typed are in the durable copy, not discarded.
    expect(rows[0].json).toContain('Be careful');
  });
});

describe('an over-quota chat keeps reaching the disk mirror (#600)', () => {
  it('turns 2 and 3 still mirror, with growing message counts', async () => {
    // The bug: saveSession rebuilt its base list from localStorage, which had
    // rejected turn 1 — so turn 2 wrote a list that never contained turn 1, and
    // nothing further reached disk. The in-memory list is what fixes it.
    const { storage } = await fresh();
    store.throwOnSet = true;
    const withMessages = (n: number) => ({
      ...session('chat'), messages: Array.from({ length: n }, (_, i) => ({ role: 'user', content: `m${i}` })),
    });
    storage.saveSession(withMessages(1) as any);
    storage.saveSession(withMessages(2) as any);
    storage.saveSession(withMessages(3) as any);

    const rows = mirrored.filter(m => m.key === 'sessions');
    expect(rows).toHaveLength(3);
    const counts = rows.map(r => JSON.parse(r.json)[0].messages.length);
    expect(counts).toEqual([1, 2, 3]);
  });

  it('a second chat does not clobber the first on disk', async () => {
    const { storage } = await fresh();
    store.throwOnSet = true;
    storage.saveSession(session('chatA') as any);
    storage.saveSession(session('chatB') as any);
    const last = mirrored.filter(m => m.key === 'sessions').at(-1)!;
    const ids = JSON.parse(last.json).map((s: any) => s.id);
    expect(ids).toContain('chatA');
    expect(ids).toContain('chatB');
  });

  it('marks storage stale on quota and clears it on a successful write', async () => {
    const { storage, sessionsAreStale } = await fresh();
    store.throwOnSet = true;
    storage.saveSession(session('a') as any);
    expect(sessionsAreStale()).toBe(true);

    store.throwOnSet = false;
    storage.saveSession(session('b') as any);
    expect(sessionsAreStale()).toBe(false);
  });

  it('survives an origin so full that even the marker cannot be written', async () => {
    // The escape hatch case from the issue: nothing at all can be stored, so
    // the marker is unavailable and recovery has to come from Settings. The
    // point here is that saving still does not throw and still reaches disk.
    const { storage } = await fresh();
    store.throwOnSet = true;
    store.hardFull = true;
    expect(() => storage.saveSession(session('a') as any)).not.toThrow();
    expect(mirrored.filter(m => m.key === 'sessions')).toHaveLength(1);
  });

  it('getSessions reflects writes localStorage refused', async () => {
    const { storage } = await fresh();
    store.throwOnSet = true;
    storage.saveSession(session('ghost') as any);
    // Before the fix this read back empty: the write never landed anywhere the
    // reader looked, so the UI lost the chat the user was in the middle of.
    expect(storage.getSessions().map(s => s.id)).toContain('ghost');
  });

  it('clearAll still empties memory, so deleted chats do not come back', async () => {
    const { storage } = await fresh();
    storage.saveSession(session('a') as any);
    storage.clearAll();
    expect(storage.getSessions()).toEqual([]);
  });
});
