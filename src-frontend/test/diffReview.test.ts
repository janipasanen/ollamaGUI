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
