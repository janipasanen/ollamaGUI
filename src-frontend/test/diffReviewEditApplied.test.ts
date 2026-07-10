import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  proposeEdit, proposeEdits, acceptEdit, getPendingEdits, clearPendingEdits,
  setDiffReviewCallback, clearDiffReviewCallback,
  setEditAppliedCallback, clearEditAppliedCallback,
  setBatchReviewCallback, clearBatchReviewCallback,
} from '../services/diffReview';
import { _mocks as fileMocks } from '../services/fileTools';

beforeEach(() => {
  clearPendingEdits();
  clearDiffReviewCallback();
  clearEditAppliedCallback();
  clearBatchReviewCallback();
  fileMocks.invoke = async () => undefined;
});

afterEach(() => {
  clearPendingEdits();
  clearDiffReviewCallback();
  clearEditAppliedCallback();
  clearBatchReviewCallback();
  fileMocks.invoke = null;
});

describe('edit-applied callback (#401)', () => {
  it('proposeEdit fires the callback with path + label after applying', async () => {
    const fired: Array<{ path: string; label?: string }> = [];
    setEditAppliedCallback((path, label) => { fired.push({ path, label }); });
    await proposeEdit({ path: 'a.ts', kind: 'apply_edit', oldString: 'x', newString: 'y', label: 'update a' });
    expect(fired).toEqual([{ path: 'a.ts', label: 'update a' }]);
  });

  it('proposeEdit does NOT fire when the edit is rejected', async () => {
    const fired: string[] = [];
    setEditAppliedCallback((path) => { fired.push(path); });
    setDiffReviewCallback(async (edit) => ({ id: edit.id, accepted: false }));
    const applied = await proposeEdit({ path: 'a.ts', kind: 'apply_edit', oldString: 'x', newString: 'y' });
    expect(applied).toBe(false);
    expect(fired).toEqual([]);
  });

  it('proposeEdits fires once per applied edit (not for rejected ones)', async () => {
    const fired: string[] = [];
    setEditAppliedCallback((path) => { fired.push(path); });
    // Batch callback rejects the second edit.
    setBatchReviewCallback(async (edits) => edits.map((e, i) => ({ id: e.id, accepted: i !== 1 })));
    const results = await proposeEdits([
      { path: 'a.ts', kind: 'apply_edit', oldString: 'x', newString: 'y' },
      { path: 'b.ts', kind: 'write_file', newString: 'n' },
    ]);
    expect(results).toEqual([true, false]);
    expect(fired).toEqual(['a.ts']); // only the applied edit fires
  });
});
