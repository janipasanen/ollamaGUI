import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPinnedFiles,
  savePinnedFiles,
  clearPinnedFiles,
  addPinnedFile,
  dropPinnedFile,
  findPinnedFile,
  pinnedContextBlock,
  pinnedFilesSummary,
  type PinnedFile,
} from '../services/pinnedFiles';

beforeEach(() => {
  localStorage.clear();
});

const f1: PinnedFile = { path: 'src/a.ts', label: 'a.ts', content: 'hello' };
const f2: PinnedFile = { path: 'src/b.ts', label: 'b.ts', content: 'world' };

describe('pinnedFiles persistence (#350)', () => {
  it('starts empty', () => {
    expect(loadPinnedFiles()).toEqual([]);
  });
  it('saves and loads pinned files', () => {
    savePinnedFiles([f1, f2]);
    expect(loadPinnedFiles()).toEqual([f1, f2]);
  });
  it('clears pinned files', () => {
    savePinnedFiles([f1]);
    clearPinnedFiles();
    expect(loadPinnedFiles()).toEqual([]);
  });
  it('ignores malformed storage', () => {
    localStorage.setItem('ollama_gui_pinned_files', 'not-json');
    expect(loadPinnedFiles()).toEqual([]);
  });
});

describe('addPinnedFile (#350)', () => {
  it('adds a new file', () => {
    expect(addPinnedFile([], f1)).toEqual([f1]);
  });
  it('dedupes by path, replacing the existing entry', () => {
    const updated: PinnedFile = { ...f1, content: 'changed' };
    expect(addPinnedFile([f1, f2], updated)).toEqual([f2, updated]);
  });
});

describe('dropPinnedFile (#350)', () => {
  it('removes by exact path', () => {
    expect(dropPinnedFile([f1, f2], 'src/a.ts')).toEqual([f2]);
  });
  it('falls back to basename match', () => {
    expect(dropPinnedFile([f1, f2], 'b.ts')).toEqual([f1]);
  });
  it('no-ops when the path is not pinned', () => {
    expect(dropPinnedFile([f1], 'src/c.ts')).toEqual([f1]);
  });
  it('no-ops on empty arg', () => {
    expect(dropPinnedFile([f1], '  ')).toEqual([f1]);
  });
});

describe('findPinnedFile (#350)', () => {
  it('finds by exact path', () => {
    expect(findPinnedFile([f1, f2], 'src/b.ts')?.label).toBe('b.ts');
  });
  it('finds by basename', () => {
    expect(findPinnedFile([f1, f2], 'a.ts')?.path).toBe('src/a.ts');
  });
  it('returns undefined when not found', () => {
    expect(findPinnedFile([f1], 'nope.ts')).toBeUndefined();
  });
});

describe('pinnedContextBlock (#350)', () => {
  it('returns empty string when no files are pinned', () => {
    expect(pinnedContextBlock([])).toBe('');
  });
  it('wraps each file in a <file path=…> envelope', () => {
    const block = pinnedContextBlock([f1]);
    expect(block).toContain('<file path="src/a.ts">');
    expect(block).toContain('hello');
    expect(block).toContain('</file>');
  });
  it('joins multiple files with double newlines', () => {
    const block = pinnedContextBlock([f1, f2]);
    expect(block).toContain('hello');
    expect(block).toContain('world');
    expect(block.split('</file>').length).toBe(3); // two closes + trailing
  });
  it('truncates very large file contents', () => {
    const big: PinnedFile = { path: 'big.txt', label: 'big.txt', content: 'x'.repeat(40_000) };
    const block = pinnedContextBlock([big]);
    expect(block).toContain('[…truncated]');
    expect(block.length).toBeLessThan(40_000);
  });
});

describe('pinnedFilesSummary (#350)', () => {
  it('reports when no files are pinned', () => {
    expect(pinnedFilesSummary([])).toBe('No pinned files');
  });
  it('lists files with per-file and total char counts', () => {
    const summary = pinnedFilesSummary([f1, f2]);
    expect(summary).toContain('Pinned files (2');
    expect(summary).toContain('src/a.ts (5 chars)');
    expect(summary).toContain('10 chars total');
  });
});
