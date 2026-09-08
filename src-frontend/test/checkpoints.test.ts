import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createCheckpoint, listCheckpoints, getCheckpoint, deleteCheckpoint,
  clearCheckpoints, rewindToCheckpoint, registerCheckpointTools,
} from '../services/checkpoints';
import { toolRegistry } from '../services/tools';
import { _mocks as fileMocks } from '../services/fileTools';
import { setBatchReviewCallback, clearBatchReviewCallback, clearDiffReviewCallback, type PendingEdit } from '../services/diffReview';

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

describe('rewindToCheckpoint — diff-review gate (#432)', () => {
  afterEach(() => {
    clearBatchReviewCallback();
    clearDiffReviewCallback();
  });

  it('routes the restore through the batch review callback (no bypass)', async () => {
    const fs = { [FILE_A]: 'original', [FILE_B]: 'original-b' };
    makeFilesystem(fs);
    const ckpt = await createCheckpoint([FILE_A, FILE_B], 'snap');
    fs[FILE_A] = 'dirty';
    fs[FILE_B] = 'dirty-b';

    // The user rejects every proposed restore in the batch review modal.
    let seenEdits = 0;
    setBatchReviewCallback(async (edits: PendingEdit[]) => {
      seenEdits = edits.length;
      return edits.map(e => ({ id: e.id, accepted: false }));
    });

    const restored = await rewindToCheckpoint(ckpt.id);
    expect(seenEdits).toBe(2);           // the rewind was surfaced for review
    expect(restored).toHaveLength(0);    // nothing overwritten after rejection
    expect(fs[FILE_A]).toBe('dirty');    // current (dirty) content preserved
    expect(fs[FILE_B]).toBe('dirty-b');
  });

  it('applies the restore when the batch review accepts', async () => {
    const fs = { [FILE_A]: 'original' };
    makeFilesystem(fs);
    const ckpt = await createCheckpoint([FILE_A], 'snap');
    fs[FILE_A] = 'dirty';

    setBatchReviewCallback(async (edits: PendingEdit[]) => edits.map(e => ({ id: e.id, accepted: true })));

    const restored = await rewindToCheckpoint(ckpt.id);
    expect(restored).toEqual([FILE_A]);
    expect(fs[FILE_A]).toBe('original'); // restored to the checkpointed state
  });

  it('with no callback registered, applies all (autonomous mode unchanged)', async () => {
    const fs = { [FILE_A]: 'orig', [FILE_B]: 'orig-b' };
    makeFilesystem(fs);
    const ckpt = await createCheckpoint([FILE_A, FILE_B], 'snap');
    fs[FILE_A] = 'dirty';
    fs[FILE_B] = 'dirty-b';

    const restored = await rewindToCheckpoint(ckpt.id);
    expect(restored).toHaveLength(2);
    expect(fs[FILE_A]).toBe('orig');
    expect(fs[FILE_B]).toBe('orig-b');
  });
});
// ── #603: sessionStorage quota resilience and skipped-path reporting ──────────

describe('sessionStorage quota resilience (#603)', () => {
  beforeEach(() => {
    clearCheckpoints();
    fileMocks.invoke = null;
  });

  afterEach(() => {
    clearCheckpoints();
    fileMocks.invoke = null;
  });

  it('in-memory survives when sessionStorage quota fails', async () => {
    makeFilesystem({ [FILE_A]: 'v1', [FILE_B]: 'v2' });
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    // Quota fails but checkpoint is created in-memory.
    const ckpt = await createCheckpoint([FILE_A, FILE_B], 'quota-test');
    // In-memory list still has it.
    expect(listCheckpoints()).toHaveLength(1);
    // getCheckpoint resolves from memory.
    expect(getCheckpoint(ckpt.id)?.label).toBe('quota-test');
    // rewindToCheckpoint still works.
    const restored = await rewindToCheckpoint(ckpt.id);
    expect(restored).toContain(FILE_A);
    spy.mockRestore();
  });

  it('createCheckpoint reports actual captured count', async () => {
    makeFilesystem({ [FILE_A]: 'v1', [FILE_B]: 'v2' });
    registerCheckpointTools();
    const tool = toolRegistry.getTool('create_checkpoint');
    expect(tool).toBeDefined();
    const result = await tool!.execute({ paths: [FILE_A, FILE_B], label: 'count-test' });
    expect(result).toContain('captured 2 of 2 file(s)');
  });

  it('createCheckpoint reports skipped files', async () => {
    makeFilesystem({ [FILE_A]: 'v1' });
    registerCheckpointTools();
    const tool = toolRegistry.getTool('create_checkpoint');
    const result = await tool!.execute({ paths: [FILE_A, '/w/missing.ts'], label: 'skip-test' });
    expect(result).toContain('captured 1 of 2 file(s)');
    expect(result).toContain('skipped (unreadable): /w/missing.ts');
  });

  it('evicts oldest checkpoints when MAX_CHECKPOINTS is exceeded', async () => {
    makeFilesystem({});
    // Create 25 checkpoints (MAX_CHECKPOINTS is 20).
    for (let i = 0; i < 25; i++) {
      await createCheckpoint([FILE_A], `ckpt-${i}`);
    }
    const list = listCheckpoints();
    expect(list).toHaveLength(20);
    // Oldest checkpoint (ckpt-0) should have been evicted.
    expect(list).toHaveLength(20);
    // Newest at index 0, oldest at index 19.  25 created, 5 evicted (ckpt-0..4),
    // so ckpt-5..ckpt-24 remain.
    expect(list[0].label).toBe('ckpt-24');
    expect(list[19].label).toBe('ckpt-5');
  });
});
