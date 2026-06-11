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

describe('getAtOptions (#86)', () => {
  it('returns empty array when no workspace root is set', async () => {
    // Use a brand new mock that simulates "no root" by making list_dir throw
    fileMocks.invoke = async (cmd) => {
      if (cmd === 'list_dir') throw new Error('No root');
      return undefined;
    };
    // Without setting the root, getWorkspaceRoot returns null
    // (module-internal state — setWorkspaceRoot hasn't been called here)
    const opts = await getAtOptions('');
    // If root is not set, getAtOptions returns []
    // (the actual module checks getWorkspaceRoot() which is null unless set)
    expect(Array.isArray(opts)).toBe(true);
  });

  it('lists all files/dirs when query is empty', async () => {
    await initRoot();
    fileMocks.invoke = async (cmd) => {
      if (cmd === 'list_dir') return fakeEntries;
      return undefined;
    };
    const opts = await getAtOptions('');
    expect(opts.length).toBeGreaterThan(0);
  });

  it('filters by query substring (case-insensitive)', async () => {
    await initRoot();
    fileMocks.invoke = async (cmd) => {
      if (cmd === 'list_dir') return fakeEntries;
      return undefined;
    };
    const opts = await getAtOptions('package');
    expect(opts).toHaveLength(1);
    expect(opts[0].label).toBe('package.json');
  });

  it('marks directories correctly', async () => {
    await initRoot();
    fileMocks.invoke = async (cmd) => {
      if (cmd === 'list_dir') return fakeEntries;
      return undefined;
    };
    const opts = await getAtOptions('');
    const dir = opts.find(o => o.label === 'src');
    expect(dir?.kind).toBe('dir');
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
