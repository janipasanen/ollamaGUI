import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  proposeEdit, acceptEdit, rejectEdit,
  getPendingEdits, clearPendingEdits,
  setDiffReviewCallback, clearDiffReviewCallback,
  diffLines,
} from '../services/diffReview';
import { _mocks as fileMocks } from '../services/fileTools';

beforeEach(() => {
  clearPendingEdits();
  clearDiffReviewCallback();
  fileMocks.invoke = async () => undefined; // default: writes succeed silently
});

afterEach(() => {
  clearPendingEdits();
  clearDiffReviewCallback();
  fileMocks.invoke = null;
});

describe('proposeEdit — no callback (#84)', () => {
  it('applies the edit immediately when no callback is set', async () => {
    let invoked = '';
    fileMocks.invoke = async (cmd) => { invoked = cmd; return undefined; };
    const applied = await proposeEdit({ path: 'f.ts', kind: 'apply_edit', oldString: 'a', newString: 'b' });
    expect(applied).toBe(true);
    expect(invoked).toBe('apply_edit');
  });

  it('calls write_file for full-file writes', async () => {
    let invoked = '';
    fileMocks.invoke = async (cmd) => { invoked = cmd; return undefined; };
    const applied = await proposeEdit({ path: 'f.ts', kind: 'write_file', newString: 'export {};' });
    expect(applied).toBe(true);
    expect(invoked).toBe('write_file');
  });
});

describe('proposeEdit — with callback (#84)', () => {
  it('calls the review callback and applies when accepted', async () => {
    setDiffReviewCallback(async (edit) => ({ id: edit.id, accepted: true }));
    fileMocks.invoke = async () => undefined;
    const applied = await proposeEdit({ path: 'f.ts', kind: 'write_file', newString: 'new' });
    expect(applied).toBe(true);
  });

  it('returns false and does NOT apply when rejected', async () => {
    setDiffReviewCallback(async (edit) => ({ id: edit.id, accepted: false }));
    let invoked = false;
    fileMocks.invoke = async () => { invoked = true; return undefined; };
    const applied = await proposeEdit({ path: 'f.ts', kind: 'write_file', newString: 'new' });
    expect(applied).toBe(false);
    expect(invoked).toBe(false);
  });

  it('adds the edit to pending while callback is awaiting', async () => {
    let pendingCount = 0;
    setDiffReviewCallback(async (edit) => {
      pendingCount = getPendingEdits().length;
      return { id: edit.id, accepted: true };
    });
    fileMocks.invoke = async () => undefined;
    await proposeEdit({ path: 'f.ts', kind: 'write_file', newString: 'x' });
    expect(pendingCount).toBe(1);
    expect(getPendingEdits()).toHaveLength(0); // cleared after decision
  });
});

describe('acceptEdit / rejectEdit (#84)', () => {
  it('acceptEdit applies the edit and removes it from pending', async () => {
    let invoked = '';
    fileMocks.invoke = async (cmd) => { invoked = cmd; return undefined; };
    // Simulate a pending edit by using a callback that pauses
    let resolve: (d: { id: string; accepted: boolean }) => void;
    const cbPromise = new Promise<{ id: string; accepted: boolean }>(r => { resolve = r; });
    setDiffReviewCallback(async () => cbPromise);
    const propPromise = proposeEdit({ path: 'f.ts', kind: 'apply_edit', oldString: 'old', newString: 'new' });
    // The edit is now pending; manually accept it
    const [pending] = getPendingEdits();
    await acceptEdit(pending.id);
    resolve!({ id: pending.id, accepted: true });
    await propPromise.catch(() => {}); // may resolve now
    expect(invoked).toBe('apply_edit');
  });

  it('rejectEdit removes the edit from pending without applying', async () => {
    let invoked = false;
    fileMocks.invoke = async () => { invoked = true; return undefined; };
    let resolve: (d: { id: string; accepted: boolean }) => void;
    const cbPromise = new Promise<{ id: string; accepted: boolean }>(r => { resolve = r; });
    setDiffReviewCallback(async () => cbPromise);
    const propPromise = proposeEdit({ path: 'f.ts', kind: 'write_file', newString: 'x' });
    const [pending] = getPendingEdits();
    expect(rejectEdit(pending.id)).toBe(true);
    resolve!({ id: pending.id, accepted: false });
    await propPromise.catch(() => {});
    expect(invoked).toBe(false);
  });
});

describe('diffLines (#84)', () => {
  it('marks unchanged lines as context', () => {
    const lines = diffLines('a\nb', 'a\nb');
    expect(lines.every(l => l.kind === 'context')).toBe(true);
  });

  it('marks removed lines', () => {
    const lines = diffLines('a\nb\nc', 'a\nc');
    const removed = lines.filter(l => l.kind === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].text).toBe('b');
  });

  it('marks added lines', () => {
    const lines = diffLines('a\nc', 'a\nb\nc');
    const added = lines.filter(l => l.kind === 'added');
    expect(added).toHaveLength(1);
    expect(added[0].text).toBe('b');
  });

  it('tracks line numbers for context lines', () => {
    const lines = diffLines('x\ny', 'x\ny');
    expect(lines[0].lineNumBefore).toBe(1);
    expect(lines[0].lineNumAfter).toBe(1);
    expect(lines[1].lineNumBefore).toBe(2);
    expect(lines[1].lineNumAfter).toBe(2);
  });

  it('empty before → all added', () => {
    const lines = diffLines('', 'hello');
    expect(lines.every(l => l.kind === 'added')).toBe(true);
  });

  it('empty after → all removed', () => {
    const lines = diffLines('hello', '');
    expect(lines.every(l => l.kind === 'removed')).toBe(true);
  });
});

import { groupHunks, mergeHunks } from '../services/diffReview';

describe('per-hunk grouping & merge (#254)', () => {
  it('groupHunks groups consecutive change lines and separates on context', () => {
    const before = 'a\nb\nc\nd\ne';
    const after = 'a\nB\nc\nD\ne';
    const lines = diffLines(before, after);
    const hunks = groupHunks(lines);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].lineIndices.length).toBe(2); // b→B (removed b + added B)
    expect(hunks[1].lineIndices.length).toBe(2); // d→D
  });

  it('groupHunks returns no hunks for identical strings', () => {
    expect(groupHunks(diffLines('x\ny', 'x\ny'))).toHaveLength(0);
  });

  it('mergeHunks with all hunks accepted equals the full after', () => {
    const before = 'a\nb\nc\nd\ne';
    const after = 'a\nB\nc\nD\ne';
    const lines = diffLines(before, after);
    expect(mergeHunks(lines, [true, true])).toBe(after);
  });

  it('mergeHunks with all hunks rejected equals the original before', () => {
    const before = 'a\nb\nc\nd\ne';
    const after = 'a\nB\nc\nD\ne';
    const lines = diffLines(before, after);
    expect(mergeHunks(lines, [false, false])).toBe(before);
  });

  it('mergeHunks with only the first hunk accepted applies just that region', () => {
    const before = 'a\nb\nc\nd\ne';
    const after = 'a\nB\nc\nD\ne';
    const lines = diffLines(before, after);
    // accept hunk 0 (b→B), reject hunk 1 (keep d)
    expect(mergeHunks(lines, [true, false])).toBe('a\nB\nc\nd\ne');
  });

  it('mergeHunks handles pure insertions (added-only hunk)', () => {
    const before = 'a\nc';
    const after = 'a\nb\nc';
    const lines = diffLines(before, after);
    expect(mergeHunks(lines, [true])).toBe(after);
    expect(mergeHunks(lines, [false])).toBe(before);
  });

  it('mergeHunks handles pure deletions (removed-only hunk)', () => {
    const before = 'a\nb\nc';
    const after = 'a\nc';
    const lines = diffLines(before, after);
    expect(mergeHunks(lines, [true])).toBe(after);
    expect(mergeHunks(lines, [false])).toBe(before);
  });
});

describe('proposeEdit — per-hunk merged content (#254)', () => {
  it('applies the mergedNewString when provided via the review decision', async () => {
    let written: Record<string, any> = {};
    fileMocks.invoke = async (cmd: string, args: any) => {
      if (cmd === 'apply_edit') written = { old_string: args.old_string, new_string: args.new_string };
      return undefined;
    };
    setDiffReviewCallback(async () => ({ id: 'x', accepted: true, mergedNewString: 'MERGED' }));
    const applied = await proposeEdit({ path: 'f.ts', kind: 'apply_edit', oldString: 'orig', newString: 'full' });
    expect(applied).toBe(true);
    expect(written.old_string).toBe('orig');
    expect(written.new_string).toBe('MERGED');
  });

  it('falls back to the full newString when no mergedNewString is provided', async () => {
    let written: Record<string, any> = {};
    fileMocks.invoke = async (cmd: string, args: any) => {
      if (cmd === 'apply_edit') written = { new_string: args.new_string };
      return undefined;
    };
    setDiffReviewCallback(async () => ({ id: 'x', accepted: true }));
    await proposeEdit({ path: 'f.ts', kind: 'apply_edit', oldString: 'orig', newString: 'full' });
    expect(written.new_string).toBe('full');
  });
});
