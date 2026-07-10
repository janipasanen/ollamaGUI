import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerFileTools, _mocks, setWorkspaceRoot } from '../services/fileTools';
import { toolRegistry } from '../services/tools';
import {
  setBatchReviewCallback, clearBatchReviewCallback, clearPendingEdits,
  type PendingEdit, type EditDecision,
} from '../services/diffReview';

beforeEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
  clearBatchReviewCallback();
  clearPendingEdits();
  _mocks.invoke = async (cmd: string) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'apply_edit') return undefined;
    if (cmd === 'write_file') return undefined;
    if (cmd === 'delete_file') return undefined;
    throw new Error(`Unexpected command: ${cmd}`);
  };
});

afterEach(() => {
  _mocks.invoke = null;
  clearBatchReviewCallback();
  clearPendingEdits();
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
});

describe('apply_patch batch diff review (#400)', () => {
  it('presents all update/create ops in ONE batch review', async () => {
    await setWorkspaceRoot('/ws');
    registerFileTools();
    const tool = toolRegistry.getTool('apply_patch')!;

    let batchCallCount = 0;
    let receivedPaths: string[] = [];
    setBatchReviewCallback(async (edits: PendingEdit[]): Promise<EditDecision[]> => {
      batchCallCount++;
      receivedPaths = edits.map(e => e.path);
      return edits.map(e => ({ id: e.id, accepted: true }));
    });

    const res = await tool.execute({
      operations: [
        { op: 'update', path: 'a.ts', old_string: 'foo', new_string: 'bar' },
        { op: 'create', path: 'b.ts', content: 'new' },
        { op: 'update', path: 'c.ts', old_string: 'x', new_string: 'y' },
      ],
    });

    expect(batchCallCount).toBe(1); // single combined review, not three
    expect(receivedPaths).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(res.success).toBe(true);
    expect(res.applied).toBe(3);
  });

  it('maps per-file reject decisions back to per-op results in order', async () => {
    await setWorkspaceRoot('/ws');
    registerFileTools();
    const tool = toolRegistry.getTool('apply_patch')!;

    setBatchReviewCallback(async (edits) =>
      // Reject the middle file (b.ts).
      edits.map((e, i) => ({ id: e.id, accepted: i !== 1 })),
    );

    const res = await tool.execute({
      operations: [
        { op: 'update', path: 'a.ts', old_string: 'foo', new_string: 'bar' },
        { op: 'create', path: 'b.ts', content: 'new' },
        { op: 'update', path: 'c.ts', old_string: 'x', new_string: 'y' },
      ],
    });

    expect(res.success).toBe(false);
    expect(res.results.map((r: any) => r.success)).toEqual([true, false, true]);
    expect(res.results[1].path).toBe('b.ts');
  });

  it('still applies delete ops alongside a batch review', async () => {
    await setWorkspaceRoot('/ws');
    registerFileTools();
    const tool = toolRegistry.getTool('apply_patch')!;

    const cmds: string[] = [];
    _mocks.invoke = async (cmd) => { cmds.push(cmd); if (cmd === 'set_workspace_root') return undefined; return undefined; };
    setBatchReviewCallback(async (edits) => edits.map(e => ({ id: e.id, accepted: true })));

    const res = await tool.execute({
      operations: [
        { op: 'create', path: 'b.ts', content: 'new' },
        { op: 'delete', path: 'd.ts' },
      ],
    });

    expect(res.success).toBe(true);
    expect(cmds).toContain('write_file');
    expect(cmds).toContain('delete_file');
  });
});
