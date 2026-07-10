import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isHashTrigger, hashQuery, getAutocompleteOptions, resolveContextRef, buildContextBlock } from '../services/hashCommand';
import { createMemoryKnowledgeDB, setKnowledgeDB } from '../services/db';
import { setEmbedFn } from '../services/rag';
import { addFile } from '../services/knowledge';
import { _mocks as webfetchMocks } from '../services/webfetch';

beforeEach(() => {
  setKnowledgeDB(createMemoryKnowledgeDB());
  setEmbedFn(async (texts) => texts.map(() => [1, 0, 0, 0]));
  webfetchMocks.fetchUrl = null;
});

afterEach(() => {
  setEmbedFn(null as any);
  webfetchMocks.fetchUrl = null;
});

describe('# trigger detection (#119)', () => {
  it('detects a bare # as a trigger', () => {
    expect(isHashTrigger('#')).toBe(true);
  });

  it('detects # at the end after a space', () => {
    expect(isHashTrigger('some text #')).toBe(true);
  });

  it('does not trigger on # in the middle of a word', () => {
    expect(isHashTrigger('test#tag')).toBe(false);
  });

  it('returns query fragment after #', () => {
    expect(hashQuery('some text #doc')).toBe('doc');
    expect(hashQuery('#my')).toBe('my');
    expect(hashQuery('#')).toBe('');
  });
});

describe('getAutocompleteOptions (#119)', () => {
  it('returns collections in options', async () => {
    const db = createMemoryKnowledgeDB();
    setKnowledgeDB(db);
    await db.saveCollection({ id: 'col1', name: 'Research Papers', createdAt: 1, updatedAt: 1 });
    const opts = await getAutocompleteOptions('');
    expect(opts.some(o => o.kind === 'collection' && o.label === 'Research Papers')).toBe(true);
  });

  it('filters options by query substring', async () => {
    const db = createMemoryKnowledgeDB();
    setKnowledgeDB(db);
    await db.saveCollection({ id: 'c1', name: 'Research Papers', createdAt: 1, updatedAt: 1 });
    await db.saveCollection({ id: 'c2', name: 'Meeting Notes', createdAt: 1, updatedAt: 2 });
    const opts = await getAutocompleteOptions('research');
    expect(opts.some(o => o.label === 'Research Papers')).toBe(true);
    expect(opts.some(o => o.label === 'Meeting Notes')).toBe(false);
  });

  it('always includes a URL option', async () => {
    const opts = await getAutocompleteOptions('');
    expect(opts.some(o => o.kind === 'url')).toBe(true);
  });
});

describe('resolveContextRef — URL (#119)', () => {
  it('fetches a URL and returns a ResolvedSource', async () => {
    webfetchMocks.fetchUrl = async (url) => ({
      url,
      title: 'Test Page',
      text: 'This is the page content',
      fetchedAt: 1000,
    });
    const sources = await resolveContextRef({ kind: 'url', url: 'https://example.com', label: 'Example' }, 'query');
    expect(sources).toHaveLength(1);
    expect(sources[0].kind).toBe('url');
    expect(sources[0].url).toBe('https://example.com');
    expect(sources[0].text).toBe('This is the page content');
  });
});

describe('resolveContextRef — collection (#119)', () => {
  it('returns retrieved chunks from a collection', async () => {
    const db = createMemoryKnowledgeDB();
    setKnowledgeDB(db);
    const col = { id: 'rc1', name: 'Col', createdAt: 1, updatedAt: 1 };
    await db.saveCollection(col);
    await addFile(col.id, 'doc.txt', 'text/plain', 40, 'the quick brown fox jumps over the lazy dog');
    // Manually add chunks since indexing requires embed which we've mocked
    const file = (await db.getFilesByCollection(col.id))[0];
    await db.putFile({ ...file, chunks: [{ index: 0, text: 'the quick brown fox', tf: { the: 1, quick: 1, brown: 1, fox: 1 }, embedding: [1, 0, 0, 0] }] });

    const sources = await resolveContextRef({ kind: 'collection', id: col.id, label: 'Col' }, 'fox');
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources[0].kind).toBe('collection');
  });
});

describe('buildContextBlock (#119)', () => {
  it('formats sources into a numbered block', () => {
    const sources = [
      { id: '1', kind: 'file' as const, label: 'doc.txt', text: 'Some content here.' },
      { id: '2', kind: 'url' as const, label: 'Example', url: 'https://example.com', text: 'Page text.' },
    ];
    const block = buildContextBlock(sources);
    expect(block).toContain('[1]');
    expect(block).toContain('[2]');
    expect(block).toContain('Some content here.');
    expect(block).toContain('Page text.');
  });

  it('returns empty string for empty sources', () => {
    expect(buildContextBlock([])).toBe('');
  });
});

describe('grounded request payload assembly (#119)', () => {
  it('multiple context refs produce multiple sources', async () => {
    webfetchMocks.fetchUrl = async (url) => ({ url, title: url, text: 'url content', fetchedAt: 1000 });

    const ref1 = { kind: 'url' as const, url: 'https://a.com', label: 'A' };
    const ref2 = { kind: 'url' as const, url: 'https://b.com', label: 'B' };

    const s1 = await resolveContextRef(ref1, 'q');
    const s2 = await resolveContextRef(ref2, 'q');
    const all = [...s1, ...s2];
    const block = buildContextBlock(all);
    expect(block).toContain('[1]');
    expect(block).toContain('[2]');
  });
});

describe('resolveContextRef — file (#119, #427)', () => {
  it('returns the file\'s extracted text for an indexed file', async () => {
    const db = createMemoryKnowledgeDB();
    setKnowledgeDB(db);
    const col = { id: 'fc1', name: 'Col', createdAt: 1, updatedAt: 1 };
    await db.saveCollection(col);
    await addFile(col.id, 'notes.txt', 'text/plain', 40, 'the quick brown fox');
    const file = (await db.getFilesByCollection(col.id))[0];

    const sources = await resolveContextRef({ kind: 'file', id: file.id, label: 'notes.txt' }, 'irrelevant query');
    expect(sources).toHaveLength(1);
    expect(sources[0].kind).toBe('file');
    expect(sources[0].fileId).toBe(file.id);
    // The actual file text is injected — not the "(file not yet indexed)" placeholder.
    expect(sources[0].text).toBe('the quick brown fox');
    expect(sources[0].text).not.toContain('not yet indexed');
  });

  it('falls back to concatenated chunks when no extracted text is stored', async () => {
    const db = createMemoryKnowledgeDB();
    setKnowledgeDB(db);
    const col = { id: 'fc2', name: 'Col', createdAt: 1, updatedAt: 1 };
    await db.saveCollection(col);
    await addFile(col.id, 'chunked.txt', 'text/plain', 40, '');
    const file = (await db.getFilesByCollection(col.id))[0];
    await db.putFile({ ...file, text: undefined, chunks: [
      { index: 0, text: 'chunk zero', tf: {}, embedding: [1, 0, 0, 0] },
      { index: 1, text: 'chunk one', tf: {}, embedding: [1, 0, 0, 0] },
    ] });

    const sources = await resolveContextRef({ kind: 'file', id: file.id, label: 'chunked.txt' }, 'q');
    expect(sources).toHaveLength(1);
    expect(sources[0].text).toContain('chunk zero');
    expect(sources[0].text).toContain('chunk one');
  });

  it('returns the placeholder when the file record is missing', async () => {
    setKnowledgeDB(createMemoryKnowledgeDB());
    const sources = await resolveContextRef({ kind: 'file', id: 'does-not-exist', label: 'ghost.txt' }, 'q');
    expect(sources).toHaveLength(1);
    expect(sources[0].text).toContain('not yet indexed');
  });

  it('caps very long file text at 20 000 characters', async () => {
    const db = createMemoryKnowledgeDB();
    setKnowledgeDB(db);
    const col = { id: 'fc3', name: 'Col', createdAt: 1, updatedAt: 1 };
    await db.saveCollection(col);
    const long = 'x'.repeat(30_000);
    await addFile(col.id, 'big.txt', 'text/plain', long.length, long);
    const file = (await db.getFilesByCollection(col.id))[0];
    const sources = await resolveContextRef({ kind: 'file', id: file.id, label: 'big.txt' }, 'q');
    expect(sources[0].text.length).toBe(20_000);
  });
});
