import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  proposeEdits, setBatchReviewCallback, clearBatchReviewCallback,
  setDiffReviewCallback, clearDiffReviewCallback,
  clearPendingEdits, type PendingEdit, type EditDecision,
} from '../services/diffReview';
import { _mocks as fileMocks } from '../services/fileTools';

beforeEach(() => {
  clearPendingEdits();
  clearBatchReviewCallback();
  clearDiffReviewCallback();
  fileMocks.invoke = async () => undefined;
});

afterEach(() => {
  clearPendingEdits();
  clearBatchReviewCallback();
  clearDiffReviewCallback();
  fileMocks.invoke = null;
});

describe('proposeEdits — no callback (#400)', () => {
  it('applies all edits immediately when no callback is set', async () => {
    const cmds: string[] = [];
    fileMocks.invoke = async (cmd) => { cmds.push(cmd); return undefined; };
    const results = await proposeEdits([
      { path: 'a.ts', kind: 'apply_edit', oldString: 'x', newString: 'y', label: 'update a' },
      { path: 'b.ts', kind: 'write_file', newString: 'new', label: 'create b' },
    ]);
    expect(results).toEqual([true, true]);
    expect(cmds).toContain('apply_edit');
    expect(cmds).toContain('write_file');
  });
});

describe('proposeEdits — batch callback (#400)', () => {
  it('passes all edits to one batch callback and applies per-edit decisions', async () => {
    let received: PendingEdit[] = [];
    setBatchReviewCallback(async (edits) => {
      received = edits;
      // Accept the first, reject the second.
      return edits.map((e, i) => ({ id: e.id, accepted: i === 0 }));
    });
    const cmds: string[] = [];
    fileMocks.invoke = async (cmd) => { cmds.push(cmd); return undefined; };

    const results = await proposeEdits([
      { path: 'a.ts', kind: 'apply_edit', oldString: 'x', newString: 'y' },
      { path: 'b.ts', kind: 'write_file', newString: 'n' },
    ]);

    expect(received).toHaveLength(2);
    expect(results).toEqual([true, false]);
    expect(cmds).toContain('apply_edit');
    expect(cmds).not.toContain('write_file'); // rejected
  });

  it('returns all-false when the batch callback rejects everything', async () => {
    setBatchReviewCallback(async (edits) => edits.map(e => ({ id: e.id, accepted: false })));
    const results = await proposeEdits([
      { path: 'a.ts', kind: 'apply_edit', oldString: 'x', newString: 'y' },
    ]);
    expect(results).toEqual([false]);
  });
});

describe('proposeEdits — single-callback fallback (#400)', () => {
  it('falls back to the per-edit callback when no batch callback is set', async () => {
    setDiffReviewCallback(async (edit) => ({ id: edit.id, accepted: edit.kind === 'apply_edit' }));
    const cmds: string[] = [];
    fileMocks.invoke = async (cmd) => { cmds.push(cmd); return undefined; };
    const results = await proposeEdits([
      { path: 'a.ts', kind: 'apply_edit', oldString: 'x', newString: 'y' },
      { path: 'b.ts', kind: 'write_file', newString: 'n' },
    ]);
    expect(results).toEqual([true, false]);
    expect(cmds).toContain('apply_edit');
  });
});
