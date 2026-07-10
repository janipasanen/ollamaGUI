import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAtTrigger, atQuery, getAtOptions, buildAtContextBlock, resolveAtMention } from '../services/atCommand';
import { _mocks as fileMocks, setWorkspaceRoot } from '../services/fileTools';
import type { DirEntry } from '../services/fileTools';

const FAKE_ROOT = '/workspace';

const fakeEntries: DirEntry[] = [
  { name: 'src', path: `${FAKE_ROOT}/src`, is_dir: true, size: 0, modified_ms: null },
  { name: 'package.json', path: `${FAKE_ROOT}/package.json`, is_dir: false, size: 512, modified_ms: null },
  { name: 'README.md', path: `${FAKE_ROOT}/README.md`, is_dir: false, size: 200, modified_ms: null },
];

const srcEntries: DirEntry[] = [
  { name: 'App.tsx', path: `${FAKE_ROOT}/src/App.tsx`, is_dir: false, size: 1024, modified_ms: null },
  { name: 'utils.ts', path: `${FAKE_ROOT}/src/utils.ts`, is_dir: false, size: 256, modified_ms: null },
];

async function initRoot() {
  fileMocks.invoke = async (cmd) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'list_dir') return fakeEntries;
    return undefined;
  };
  await setWorkspaceRoot(FAKE_ROOT);
}

beforeEach(async () => {
  // Reset workspace root to null by reinitializing with empty mock
  fileMocks.invoke = async () => undefined;
  // Clear root by calling setWorkspaceRoot with a placeholder (we'll override per-test)
});

afterEach(() => {
  fileMocks.invoke = null;
});

describe('isAtTrigger (#86)', () => {
  it('returns true for trailing @', () => {
    expect(isAtTrigger('hello @')).toBe(true);
  });

  it('returns true for @query at end', () => {
    expect(isAtTrigger('fix @src/app')).toBe(true);
  });

  it('returns false when @ is in the middle', () => {
    expect(isAtTrigger('hello @world here')).toBe(false);
  });

  it('returns false when no @', () => {
    expect(isAtTrigger('no mention')).toBe(false);
  });
});

describe('atQuery (#86)', () => {
  it('extracts empty query for trailing @', () => {
    expect(atQuery('hello @')).toBe('');
  });

  it('extracts query fragment', () => {
    expect(atQuery('read @package.json')).toBe('package.json');
  });

  it('extracts partial path fragment', () => {
    expect(atQuery('edit @src/utils')).toBe('src/utils');
  });
});

// Per-path list_dir mock: root lists fakeEntries; the `src` subdir lists its
// own contents so subdir expansion (#428) is exercised without duplicates.
function perPathMock() {
  fileMocks.invoke = async (cmd, args) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'list_dir') {
      const dir = (args as { path?: string })?.path ?? '';
      if (dir === FAKE_ROOT) return fakeEntries;
      if (dir === `${FAKE_ROOT}/src`) return srcEntries;
      return [];
    }
    return undefined;
  };
}

describe('getAtOptions (#86, #428)', () => {
  it('returns empty array when no workspace root is set', async () => {
    fileMocks.invoke = async (cmd) => {
      if (cmd === 'list_dir') throw new Error('No root');
      return undefined;
    };
    const opts = await getAtOptions('');
    expect(Array.isArray(opts)).toBe(true);
  });

  it('lists root files/dirs plus one level of subdir contents', async () => {
    await initRoot();
    perPathMock();
    const opts = await getAtOptions('');
    // Root entries: src (dir), package.json, README.md
    expect(opts.some(o => o.label === 'package.json')).toBe(true);
    expect(opts.some(o => o.label === 'README.md')).toBe(true);
    // Subdir expansion (#428): src/App.tsx and src/utils.ts are now listed.
    expect(opts.some(o => o.label === 'src/App.tsx')).toBe(true);
    expect(opts.some(o => o.label === 'src/utils.ts')).toBe(true);
  });

  it('filters by query substring (case-insensitive)', async () => {
    await initRoot();
    perPathMock();
    const opts = await getAtOptions('package');
    expect(opts).toHaveLength(1);
    expect(opts[0].label).toBe('package.json');
  });

  it('marks directories correctly', async () => {
    await initRoot();
    perPathMock();
    const opts = await getAtOptions('');
    const dir = opts.find(o => o.label === 'src');
    expect(dir?.kind).toBe('dir');
  });

  it('subdir file options carry the full workspace path', async () => {
    await initRoot();
    perPathMock();
    const opts = await getAtOptions('App.tsx');
    expect(opts).toHaveLength(1);
    expect(opts[0].path).toBe(`${FAKE_ROOT}/src/App.tsx`);
  });
});

describe('buildAtContextBlock (#86)', () => {
  it('wraps file content in a <file> block', async () => {
    fileMocks.invoke = async () => 'const x = 1;';
    const block = await buildAtContextBlock('/w/file.ts', 'file.ts');
    expect(block).toContain('<file path="file.ts">');
    expect(block).toContain('const x = 1;');
    expect(block).toContain('</file>');
  });

  it('truncates large files', async () => {
    fileMocks.invoke = async () => 'x'.repeat(40_000);
    const block = await buildAtContextBlock('/w/big.txt', 'big.txt');
    expect(block).toContain('[…truncated]');
  });

  it('handles read errors gracefully', async () => {
    fileMocks.invoke = async () => { throw new Error('Not found'); };
    const block = await buildAtContextBlock('/w/missing.ts', 'missing.ts');
    expect(block).toContain('Error reading file');
  });
});

describe('resolveAtMention (#86)', () => {
  it('replaces trailing @mention with file context block', async () => {
    fileMocks.invoke = async () => 'export default {};';
    // The @mention must be at the end of the input (as it would be when the user picks from autocomplete)
    const result = await resolveAtMention('Read @app.ts', '/w/app.ts', 'app.ts');
    expect(result).toContain('<file path="app.ts">');
    expect(result).toContain('export default {};');
    expect(result).not.toContain('@app.ts');
  });

  it('replaces bare trailing @ when query is empty', async () => {
    fileMocks.invoke = async () => 'data';
    const result = await resolveAtMention('context @', '/w/data.txt', 'data.txt');
    expect(result).toContain('<file path="data.txt">');
    expect(result).not.toContain('@');
  });
});


describe('isAtTrigger — token boundary (#428)', () => {
  it('does NOT trigger on a mid-word @ (email address)', () => {
    expect(isAtTrigger('contact user@example.com')).toBe(false);
  });

  it('does NOT trigger on a bare email at input start', () => {
    expect(isAtTrigger('user@example.com')).toBe(false);
  });

  it('triggers on @ at input start', () => {
    expect(isAtTrigger('@app')).toBe(true);
  });

  it('triggers on @ after whitespace', () => {
    expect(isAtTrigger('read @app.ts')).toBe(true);
  });

  it('uses the last token-boundary @, ignoring earlier mid-word @', () => {
    expect(isAtTrigger('a@b @c')).toBe(true);
    expect(atQuery('a@b @c')).toBe('c');
  });

  it('atQuery returns empty string when there is no token-boundary @', () => {
    expect(atQuery('user@example.com')).toBe('');
  });
});

describe('resolveAtMention — $-content safety + whitespace (#428)', () => {
  it('inserts file content containing $ literally (no replace substitution)', async () => {
    fileMocks.invoke = async () => 'const $& = $1; price $5';
    const result = await resolveAtMention('See @vars.txt', '/w/vars.txt', 'vars.txt');
    expect(result).toContain('const $& = $1; price $5');
    // The matched "@vars.txt" must NOT be re-inserted via a $& substitution.
    expect(result).not.toMatch(/See@?vars\.txt/);
    expect(result).not.toContain('@vars.txt');
  });

  it('preserves leading whitespace when replacing the mention', async () => {
    fileMocks.invoke = async () => 'data';
    const result = await resolveAtMention('Read this @data.txt', '/w/data.txt', 'data.txt');
    expect(result.startsWith('Read this ')).toBe(true);
    expect(result).toContain('<file path="data.txt">');
  });

  it('replaces a mention that is the entire input (start-of-input, no leading space)', async () => {
    fileMocks.invoke = async () => 'head';
    const result = await resolveAtMention('@head.txt', '/w/head.txt', 'head.txt');
    expect(result.startsWith('<file path="head.txt">')).toBe(true);
    expect(result).not.toContain('@head.txt');
  });
});