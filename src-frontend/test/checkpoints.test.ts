import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createCheckpoint, listCheckpoints, getCheckpoint, deleteCheckpoint,
  clearCheckpoints, rewindToCheckpoint,
} from '../services/checkpoints';
import { _mocks as fileMocks } from '../services/fileTools';

const FILE_A = '/w/src/app.ts';
const FILE_B = '/w/src/utils.ts';

function makeFilesystem(fs: Record<string, string>) {
  fileMocks.invoke = async (cmd, args) => {
    const a = args as any;
    if (cmd === 'read_file') {
      const content = fs[a.path];
      if (content === undefined) throw new Error(`Not found: ${a.path}`);
      return content;
    }
    if (cmd === 'write_file') {
      fs[a.path] = a.content;
      return undefined;
    }
    return undefined;
  };
}

beforeEach(() => {
  clearCheckpoints();
  fileMocks.invoke = null;
});

afterEach(() => {
  clearCheckpoints();
  fileMocks.invoke = null;
});

describe('createCheckpoint (#91)', () => {
  it('reads the given paths and stores their content', async () => {
    const fs = { [FILE_A]: 'const a = 1;', [FILE_B]: 'export {};' };
    makeFilesystem(fs);
    const ckpt = await createCheckpoint([FILE_A, FILE_B], 'before refactor');
    expect(ckpt.label).toBe('before refactor');
    expect(ckpt.files[FILE_A]).toBe('const a = 1;');
    expect(ckpt.files[FILE_B]).toBe('export {};');
  });

  it('silently skips files that do not exist yet', async () => {
    const fs = { [FILE_A]: 'hello' };
    makeFilesystem(fs);
    const ckpt = await createCheckpoint([FILE_A, '/w/missing.ts'], 'test');
    expect(ckpt.files[FILE_A]).toBe('hello');
    expect(ckpt.files['/w/missing.ts']).toBeUndefined();
  });

  it('appears in listCheckpoints newest-first', async () => {
    makeFilesystem({});
    await createCheckpoint([], 'first');
    await createCheckpoint([], 'second');
    const list = listCheckpoints();
    expect(list[0].label).toBe('second');
    expect(list[1].label).toBe('first');
  });
});

describe('getCheckpoint / deleteCheckpoint (#91)', () => {
  it('getCheckpoint returns the checkpoint by id', async () => {
    makeFilesystem({ [FILE_A]: 'v1' });
    const ckpt = await createCheckpoint([FILE_A], 'snap');
    const loaded = getCheckpoint(ckpt.id);
    expect(loaded?.label).toBe('snap');
  });

  it('getCheckpoint returns undefined for unknown id', () => {
    expect(getCheckpoint('unknown')).toBeUndefined();
  });

  it('deleteCheckpoint removes it', async () => {
    makeFilesystem({});
    const ckpt = await createCheckpoint([], 'to-delete');
    deleteCheckpoint(ckpt.id);
    expect(getCheckpoint(ckpt.id)).toBeUndefined();
  });
});

describe('rewindToCheckpoint (#91)', () => {
  it('restores files to their captured state', async () => {
    const fs = { [FILE_A]: 'original content', [FILE_B]: 'original utils' };
    makeFilesystem(fs);
    const ckpt = await createCheckpoint([FILE_A, FILE_B], 'before edit');

    // Simulate the agent making changes
    fs[FILE_A] = 'modified content';
    fs[FILE_B] = 'modified utils';

    const restored = await rewindToCheckpoint(ckpt.id);
    expect(restored).toHaveLength(2);
    expect(fs[FILE_A]).toBe('original content');
    expect(fs[FILE_B]).toBe('original utils');
  });

  it('returns the list of restored file paths', async () => {
    const fs = { [FILE_A]: 'v1' };
    makeFilesystem(fs);
    const ckpt = await createCheckpoint([FILE_A], 'snap');
    const paths = await rewindToCheckpoint(ckpt.id);
    expect(paths).toContain(FILE_A);
  });

  it('throws if the checkpoint id is unknown', async () => {
    await expect(rewindToCheckpoint('bad-id')).rejects.toThrow("Checkpoint 'bad-id' not found");
  });
});

describe('clearCheckpoints', () => {
  it('removes all checkpoints', async () => {
    makeFilesystem({});
    await createCheckpoint([], 'a');
    await createCheckpoint([], 'b');
    clearCheckpoints();
    expect(listCheckpoints()).toHaveLength(0);
  });
});
