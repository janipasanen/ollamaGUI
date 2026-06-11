/**
 * Knowledge collection CRUD (#117).
 *
 * Wraps the KnowledgeDB layer. Collections and their files persist in IndexedDB
 * (not localStorage) to handle large document text without quota issues.
 */

import { getKnowledgeDB, type KnowledgeCollection, type KnowledgeFile } from './db';

export type { KnowledgeCollection, KnowledgeFile };

function generateId(): string {
  return `kn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function createCollection(name: string, description?: string): Promise<KnowledgeCollection> {
  const db = await getKnowledgeDB();
  const now = Date.now();
  const c: KnowledgeCollection = { id: generateId(), name: name.trim(), description, createdAt: now, updatedAt: now };
  await db.saveCollection(c);
  return c;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const db = await getKnowledgeDB();
  const cols = await db.getCollections();
  const existing = cols.find(c => c.id === id);
  if (!existing) throw new Error(`Collection ${id} not found`);
  await db.saveCollection({ ...existing, name: name.trim(), updatedAt: Date.now() });
}

export async function deleteCollection(id: string): Promise<void> {
  const db = await getKnowledgeDB();
  await db.deleteFilesByCollection(id);
  await db.deleteCollection(id);
}

export async function listCollections(): Promise<KnowledgeCollection[]> {
  const db = await getKnowledgeDB();
  return (await db.getCollections()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCollection(id: string): Promise<KnowledgeCollection | undefined> {
  const db = await getKnowledgeDB();
  const cols = await db.getCollections();
  return cols.find(c => c.id === id);
}

export async function addFile(
  collectionId: string,
  name: string,
  mime: string,
  sizeBytes: number,
  text?: string,
): Promise<KnowledgeFile> {
  const db = await getKnowledgeDB();
  const f: KnowledgeFile = {
    id: generateId(),
    collectionId,
    name,
    mime,
    sizeBytes,
    addedAt: Date.now(),
    text,
  };
  await db.putFile(f);
  // Bump collection updatedAt so the list re-sorts
  const col = (await db.getCollections()).find(c => c.id === collectionId);
  if (col) await db.saveCollection({ ...col, updatedAt: Date.now() });
  return f;
}

export async function removeFile(fileId: string): Promise<void> {
  const db = await getKnowledgeDB();
  await db.deleteFile(fileId);
}

export async function getFilesForCollection(collectionId: string): Promise<KnowledgeFile[]> {
  const db = await getKnowledgeDB();
  return (await db.getFilesByCollection(collectionId)).sort((a, b) => a.addedAt - b.addedAt);
}

export async function getCollectionStats(collectionId: string): Promise<{ fileCount: number; totalBytes: number }> {
  const files = await getFilesForCollection(collectionId);
  return { fileCount: files.length, totalBytes: files.reduce((s, f) => s + f.sizeBytes, 0) };
}
