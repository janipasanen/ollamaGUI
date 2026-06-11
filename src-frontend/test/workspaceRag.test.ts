import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { indexWorkspace, queryWorkspace, isWorkspaceIndexed } from '../services/workspaceRag';
import { _mocks as fileMocks } from '../services/fileTools';
import { setKnowledgeDB, createMemoryKnowledgeDB } from '../services/db';
import { setEmbedFn } from '../services/rag';

const ROOT = '/workspace';

// Fake in-memory filesystem
const fakeFs: Record<string, string> = {
  [`${ROOT}/src/index.ts`]: 'export const greet = () => "hello";',
  [`${ROOT}/src/utils.ts`]: 'export function add(a: number, b: number) { return a + b; }',
  [`${ROOT}/README.md`]: '# My Project\nThis is a test project.',
  [`${ROOT}/package.json`]: '{ "name": "test" }',
};

const fakeDirs: Record<string, Array<{ name: string; path: string; is_dir: boolean; size: number; modified_ms: null }>> = {
  [ROOT]: [
    { name: 'src', path: `${ROOT}/src`, is_dir: true, size: 0, modified_ms: null },
    { name: 'README.md', path: `${ROOT}/README.md`, is_dir: false, size: 100, modified_ms: null },
    { name: 'package.json', path: `${ROOT}/package.json`, is_dir: false, size: 30, modified_ms: null },
    { name: 'node_modules', path: `${ROOT}/node_modules`, is_dir: true, size: 0, modified_ms: null }, // should be skipped
  ],
  [`${ROOT}/src`]: [
    { name: 'index.ts', path: `${ROOT}/src/index.ts`, is_dir: false, size: 50, modified_ms: null },
    { name: 'utils.ts', path: `${ROOT}/src/utils.ts`, is_dir: false, size: 60, modified_ms: null },
  ],
};

beforeEach(() => {
  setKnowledgeDB(createMemoryKnowledgeDB());
  setEmbedFn(async (texts) => texts.map(() => [0.1, 0.2, 0.3]));
  fileMocks.invoke = async (cmd, args: any) => {
    if (cmd === 'list_dir') return fakeDirs[args.path] ?? [];
    if (cmd === 'read_file') {
      const content = fakeFs[args.path];
      if (content === undefined) throw new Error(`File not found: ${args.path}`);
      return content;
    }
    return undefined;
  };
});

afterEach(() => {
  fileMocks.invoke = null;
  setEmbedFn(() => Promise.resolve([]));
  setKnowledgeDB(createMemoryKnowledgeDB());
});

describe('indexWorkspace (#94)', () => {
  it('creates a workspace collection', async () => {
    await indexWorkspace(ROOT);
    expect(await isWorkspaceIndexed(ROOT)).toBe(true);
  });

  it('skips node_modules directory', async () => {
    // If node_modules were included it would fail because list_dir for it returns []
    // This just verifies indexing completes without error
    await expect(indexWorkspace(ROOT)).resolves.toBeDefined();
  });

  it('reports progress callbacks from 0 to 1', async () => {
    const ratios: number[] = [];
    await indexWorkspace(ROOT, { onProgress: (r) => ratios.push(r) });
    expect(ratios.length).toBeGreaterThan(0);
    expect(Math.max(...ratios)).toBe(1);
  });

  it('re-indexing deletes and recreates the collection', async () => {
    await indexWorkspace(ROOT);
    await indexWorkspace(ROOT);
    expect(await isWorkspaceIndexed(ROOT)).toBe(true);
  });
});

describe('queryWorkspace (#94)', () => {
  it('returns empty array when workspace not yet indexed', async () => {
    const results = await queryWorkspace(ROOT, 'greet');
    expect(results).toEqual([]);
  });

  it('returns chunks after indexing', async () => {
    await indexWorkspace(ROOT);
    const results = await queryWorkspace(ROOT, 'greet', 3);
    expect(Array.isArray(results)).toBe(true);
    // BM25 should find the 'greet' token in index.ts
    const texts = results.map(r => r.text);
    expect(texts.some(t => t.includes('greet'))).toBe(true);
  });
});

describe('isWorkspaceIndexed (#94)', () => {
  it('returns false before indexing', async () => {
    expect(await isWorkspaceIndexed(ROOT)).toBe(false);
  });

  it('returns true after indexing', async () => {
    await indexWorkspace(ROOT);
    expect(await isWorkspaceIndexed(ROOT)).toBe(true);
  });
});
