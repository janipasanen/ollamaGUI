/**
 * In-memory KnowledgeDB (#117): the test/SSR implementation of the knowledge
 * collection + file store. Verifies the KnowledgeDB contract that rag.ts and
 * knowledge.ts rely on.
 */
import { describe, it, expect } from 'vitest';
import { createMemoryKnowledgeDB, type KnowledgeCollection, type KnowledgeFile } from '../services/db';

function col(id: string, name: string): KnowledgeCollection {
  return { id, name, createdAt: 1, updatedAt: 1 };
}
function file(id: string, collectionId: string, over: Partial<KnowledgeFile> = {}): KnowledgeFile {
  return { id, collectionId, name: id, mime: 'text/plain', sizeBytes: 10, addedAt: 1, ...over };
}

describe('createMemoryKnowledgeDB (#117)', () => {
  it('starts empty', async () => {
    const db = createMemoryKnowledgeDB();
    expect(await db.getCollections()).toEqual([]);
  });

  it('saveCollection + getCollections round-trips', async () => {
    const db = createMemoryKnowledgeDB();
    await db.saveCollection(col('c1', 'Docs'));
    await db.saveCollection(col('c2', 'Notes'));
    const cols = await db.getCollections();
    expect(cols.map(c => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('saveCollection upserts by id', async () => {
    const db = createMemoryKnowledgeDB();
    await db.saveCollection(col('c1', 'Old'));
    await db.saveCollection(col('c1', 'New'));
    const cols = await db.getCollections();
    expect(cols).toHaveLength(1);
    expect(cols[0].name).toBe('New');
  });

  it('deleteCollection removes only the targeted collection', async () => {
    const db = createMemoryKnowledgeDB();
    await db.saveCollection(col('c1', 'A'));
    await db.saveCollection(col('c2', 'B'));
    await db.deleteCollection('c1');
    expect((await db.getCollections()).map(c => c.id)).toEqual(['c2']);
  });

  it('putFile + getFile round-trips and preserves chunks/text', async () => {
    const db = createMemoryKnowledgeDB();
    await db.putFile(file('f1', 'c1', { text: 'hello', chunks: [{ index: 0, text: 'hello', tf: { hello: 1 } }] }));
    const f = await db.getFile('f1');
    expect(f?.text).toBe('hello');
    expect(f?.chunks).toHaveLength(1);
  });

  it('getFile returns undefined for an unknown id', async () => {
    const db = createMemoryKnowledgeDB();
    expect(await db.getFile('nope')).toBeUndefined();
  });

  it('getFilesByCollection filters by collectionId', async () => {
    const db = createMemoryKnowledgeDB();
    await db.putFile(file('f1', 'c1'));
    await db.putFile(file('f2', 'c1'));
    await db.putFile(file('f3', 'c2'));
    expect((await db.getFilesByCollection('c1')).map(f => f.id).sort()).toEqual(['f1', 'f2']);
    expect((await db.getFilesByCollection('c2')).map(f => f.id)).toEqual(['f3']);
    expect(await db.getFilesByCollection('empty')).toEqual([]);
  });

  it('deleteFile removes only the targeted file', async () => {
    const db = createMemoryKnowledgeDB();
    await db.putFile(file('f1', 'c1'));
    await db.putFile(file('f2', 'c1'));
    await db.deleteFile('f1');
    expect(await db.getFile('f1')).toBeUndefined();
    expect(await db.getFile('f2')).toBeDefined();
  });

  it('deleteFilesByCollection removes all files in a collection only', async () => {
    const db = createMemoryKnowledgeDB();
    await db.putFile(file('f1', 'c1'));
    await db.putFile(file('f2', 'c1'));
    await db.putFile(file('f3', 'c2'));
    await db.deleteFilesByCollection('c1');
    expect(await db.getFilesByCollection('c1')).toEqual([]);
    expect((await db.getFilesByCollection('c2')).map(f => f.id)).toEqual(['f3']);
  });

  it('each createMemoryKnowledgeDB() instance is independent', async () => {
    const a = createMemoryKnowledgeDB();
    const b = createMemoryKnowledgeDB();
    await a.saveCollection(col('c1', 'A'));
    expect(await b.getCollections()).toEqual([]);
  });
});
