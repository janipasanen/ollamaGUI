import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryKnowledgeDB, setKnowledgeDB } from '../services/db';
import {
  createCollection, renameCollection, deleteCollection,
  listCollections, addFile, removeFile, getFilesForCollection, getCollectionStats,
} from '../services/knowledge';

beforeEach(() => {
  setKnowledgeDB(createMemoryKnowledgeDB());
});

describe('knowledge collections (#117)', () => {
  it('creates a collection with a generated id and createdAt', async () => {
    const col = await createCollection('My Docs');
    expect(col.id).toMatch(/^kn_/);
    expect(col.name).toBe('My Docs');
    expect(col.createdAt).toBeGreaterThan(0);
  });

  it('lists collections sorted by updatedAt desc', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const a = await createCollection('A');
    vi.setSystemTime(2000);
    const b = await createCollection('B');
    vi.useRealTimers();
    const list = await listCollections();
    // B was created later, so it appears first
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it('renames a collection', async () => {
    const col = await createCollection('Old Name');
    await renameCollection(col.id, 'New Name');
    const list = await listCollections();
    expect(list.find(c => c.id === col.id)?.name).toBe('New Name');
  });

  it('throws when renaming an unknown collection', async () => {
    await expect(renameCollection('nope', 'X')).rejects.toThrow('not found');
  });

  it('deletes a collection and all its files', async () => {
    const col = await createCollection('Temp');
    await addFile(col.id, 'a.txt', 'text/plain', 100, 'hello');
    await deleteCollection(col.id);
    const list = await listCollections();
    expect(list.find(c => c.id === col.id)).toBeUndefined();
  });

  it('adds and lists files within a collection', async () => {
    const col = await createCollection('Papers');
    const f1 = await addFile(col.id, 'paper.txt', 'text/plain', 500, 'contents');
    const f2 = await addFile(col.id, 'notes.md', 'text/markdown', 200, 'notes');
    const files = await getFilesForCollection(col.id);
    expect(files).toHaveLength(2);
    expect(files.map(f => f.id).sort()).toEqual([f1.id, f2.id].sort());
  });

  it('removes a file by id', async () => {
    const col = await createCollection('C');
    const f = await addFile(col.id, 'x.txt', 'text/plain', 10, 'x');
    await removeFile(f.id);
    const files = await getFilesForCollection(col.id);
    expect(files).toHaveLength(0);
  });

  it('getCollectionStats returns file count and total bytes', async () => {
    const col = await createCollection('Stats');
    await addFile(col.id, 'a.txt', 'text/plain', 1000, 'a');
    await addFile(col.id, 'b.txt', 'text/plain', 2000, 'b');
    const stats = await getCollectionStats(col.id);
    expect(stats.fileCount).toBe(2);
    expect(stats.totalBytes).toBe(3000);
  });

  it('persistence round-trip: data survives getCollection call', async () => {
    const col = await createCollection('Persist');
    await addFile(col.id, 'f.txt', 'text/plain', 42, 'data');
    const list = await listCollections();
    expect(list.find(c => c.id === col.id)?.name).toBe('Persist');
    const files = await getFilesForCollection(col.id);
    expect(files[0].text).toBe('data');
  });

  it('adding a large file does not throw QuotaExceededError (no localStorage write)', async () => {
    const col = await createCollection('Large');
    const bigText = 'x'.repeat(5 * 1024 * 1024); // 5 MB string
    await expect(addFile(col.id, 'big.txt', 'text/plain', bigText.length, bigText)).resolves.toBeDefined();
  });

  it('trimming file does not affect unrelated collection', async () => {
    const colA = await createCollection('A');
    const colB = await createCollection('B');
    const fa = await addFile(colA.id, 'fa.txt', 'text/plain', 10, 'fa');
    await addFile(colB.id, 'fb.txt', 'text/plain', 20, 'fb');
    await removeFile(fa.id);
    expect(await getFilesForCollection(colA.id)).toHaveLength(0);
    expect(await getFilesForCollection(colB.id)).toHaveLength(1);
  });

  it('deleteCollection removes files only from that collection', async () => {
    const colA = await createCollection('A');
    const colB = await createCollection('B');
    await addFile(colA.id, 'fa.txt', 'text/plain', 10, 'fa');
    await addFile(colB.id, 'fb.txt', 'text/plain', 20, 'fb');
    await deleteCollection(colA.id);
    expect(await getFilesForCollection(colA.id)).toHaveLength(0);
    expect(await getFilesForCollection(colB.id)).toHaveLength(1);
  });
});
