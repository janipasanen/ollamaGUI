/**
 * IndexedDB wrapper for knowledge collections and files (#117).
 *
 * Exports two implementations:
 *   - `createIdbKnowledgeDB()` — real IndexedDB (production)
 *   - `createMemoryKnowledgeDB()` — in-memory store (tests / SSR)
 *
 * The shared `KnowledgeDB` interface is what `knowledge.ts` and `rag.ts` consume.
 */

export interface KnowledgeCollection {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeFile {
  id: string;
  collectionId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  addedAt: number;
  /** Extracted plaintext (txt/md only; large binary files leave this undefined). */
  text?: string;
  /** Embedded chunk vectors persisted for retrieval. */
  chunks?: ChunkRecord[];
}

export interface ChunkRecord {
  index: number;
  text: string;
  embedding?: number[];
  /** BM25 token frequency map for this chunk. */
  tf?: Record<string, number>;
}

export interface KnowledgeDB {
  getCollections(): Promise<KnowledgeCollection[]>;
  saveCollection(c: KnowledgeCollection): Promise<void>;
  deleteCollection(id: string): Promise<void>;
  getFile(id: string): Promise<KnowledgeFile | undefined>;
  putFile(f: KnowledgeFile): Promise<void>;
  deleteFile(id: string): Promise<void>;
  getFilesByCollection(collectionId: string): Promise<KnowledgeFile[]>;
  /** Delete all files belonging to a collection (called before deleteCollection). */
  deleteFilesByCollection(collectionId: string): Promise<void>;
}

// ── In-memory store (tests + fallback) ───────────────────────────────────────

export function createMemoryKnowledgeDB(): KnowledgeDB {
  const collections = new Map<string, KnowledgeCollection>();
  const files = new Map<string, KnowledgeFile>();

  return {
    async getCollections() { return [...collections.values()]; },
    async saveCollection(c) { collections.set(c.id, c); },
    async deleteCollection(id) { collections.delete(id); },
    async getFile(id) { return files.get(id); },
    async putFile(f) { files.set(f.id, f); },
    async deleteFile(id) { files.delete(id); },
    async getFilesByCollection(collectionId) {
      return [...files.values()].filter(f => f.collectionId === collectionId);
    },
    async deleteFilesByCollection(collectionId) {
      for (const [k, f] of files) { if (f.collectionId === collectionId) files.delete(k); }
    },
  };
}

// ── IndexedDB store (production) ──────────────────────────────────────────────

const DB_NAME = 'ollama_gui_knowledge';
const DB_VERSION = 1;
const STORE_COLLECTIONS = 'collections';
const STORE_FILES = 'files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
        db.createObjectStore(STORE_COLLECTIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        const fs = db.createObjectStore(STORE_FILES, { keyPath: 'id' });
        fs.createIndex('by_collection', 'collectionId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => res(req.result ?? undefined);
    req.onerror = () => rej(req.error);
  });
}

function idbPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(value);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => res(req.result ?? []);
    req.onerror = () => rej(req.error);
  });
}

function idbGetByIndex<T>(db: IDBDatabase, store: string, index: string, key: string): Promise<T[]> {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).index(index).getAll(key);
    req.onsuccess = () => res(req.result ?? []);
    req.onerror = () => rej(req.error);
  });
}

function idbDeleteByIndex(db: IDBDatabase, store: string, index: string, key: string): Promise<void> {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const idx = tx.objectStore(store).index(index);
    const req = idx.getAllKeys(key);
    req.onsuccess = () => {
      const keys = req.result;
      let count = keys.length;
      if (count === 0) { res(); return; }
      for (const k of keys) {
        const dr = tx.objectStore(store).delete(k);
        dr.onsuccess = () => { count--; if (count === 0) res(); };
        dr.onerror = () => rej(dr.error);
      }
    };
    req.onerror = () => rej(req.error);
  });
}

export async function createIdbKnowledgeDB(): Promise<KnowledgeDB> {
  const db = await openDb();
  return {
    async getCollections() { return idbGetAll<KnowledgeCollection>(db, STORE_COLLECTIONS); },
    async saveCollection(c) { await idbPut(db, STORE_COLLECTIONS, c); },
    async deleteCollection(id) { await idbDelete(db, STORE_COLLECTIONS, id); },
    async getFile(id) { return idbGet<KnowledgeFile>(db, STORE_FILES, id); },
    async putFile(f) { await idbPut(db, STORE_FILES, f); },
    async deleteFile(id) { await idbDelete(db, STORE_FILES, id); },
    async getFilesByCollection(collectionId) {
      return idbGetByIndex<KnowledgeFile>(db, STORE_FILES, 'by_collection', collectionId);
    },
    async deleteFilesByCollection(collectionId) {
      await idbDeleteByIndex(db, STORE_FILES, 'by_collection', collectionId);
    },
  };
}

// ── Singleton (lazily initialized) ────────────────────────────────────────────

let _db: KnowledgeDB | null = null;

/** Returns the singleton KnowledgeDB. Falls back to in-memory when IndexedDB is unavailable. */
export async function getKnowledgeDB(): Promise<KnowledgeDB> {
  if (_db) return _db;
  try {
    _db = await createIdbKnowledgeDB();
  } catch {
    _db = createMemoryKnowledgeDB();
  }
  return _db;
}

/** Override the singleton (used in tests). */
export function setKnowledgeDB(db: KnowledgeDB): void {
  _db = db;
}
