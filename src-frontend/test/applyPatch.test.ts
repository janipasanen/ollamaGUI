import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerFileTools, _mocks, setWorkspaceRoot } from '../services/fileTools';
import { clearDiffReviewCallback, setDiffReviewCallback } from '../services/diffReview';
import { toolRegistry } from '../services/tools';

beforeEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
  _mocks.invoke = async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'apply_edit') return undefined;
    if (cmd === 'write_file') return undefined;
    if (cmd === 'delete_file') return undefined;
    throw new Error(`Unexpected command: ${cmd}`);
  };
});

afterEach(() => {
  _mocks.invoke = null;
  clearDiffReviewCallback();
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
});

describe('apply_patch multi-file tool (#397)', () => {
  it('registers the apply_patch tool', async () => {
    await setWorkspaceRoot('/ws');
    registerFileTools();
    expect(toolRegistry.getTool('apply_patch')).toBeDefined();
  });

  it('applies update + create + delete ops and reports a per-op summary', async () => {
    await setWorkspaceRoot('/ws');
    registerFileTools();
    const tool = toolRegistry.getTool('apply_patch')!;

    const seen: Array<{ cmd: string; path: string }> = [];
    _mocks.invoke = async (cmd, args) => {
      seen.push({ cmd, path: (args as any).path });
      if (cmd === 'set_workspace_root') return undefined;
      return undefined;
    };

    const res = await tool.execute({
      operations: [
        { op: 'update', path: 'a.ts', old_string: 'foo', new_string: 'bar' },
        { op: 'create', path: 'b.ts', content: 'new' },
        { op: 'delete', path: 'c.ts' },
      ],
    });

    expect(res.success).toBe(true);
    expect(res.total).toBe(3);
    expect(res.applied).toBe(3);
    const cmds = seen.map(s => s.cmd);
    expect(cmds).toContain('apply_edit');
    expect(cmds).toContain('write_file');
    expect(cmds).toContain('delete_file');
    expect(res.results).toHaveLength(3);
    expect(res.results.map((r: any) => r.op)).toEqual(['update', 'create', 'delete']);
  });

  it('reports failure when a delete op errors', async () => {
    await setWorkspaceRoot('/ws');
    registerFileTools();
    const tool = toolRegistry.getTool('apply_patch')!;

    _mocks.invoke = async (cmd) => {
      if (cmd === 'set_workspace_root') return undefined;
      if (cmd === 'delete_file') throw new Error('no such file');
      return undefined;
    };

    const res = await tool.execute({
      operations: [{ op: 'delete', path: 'missing.ts' }],
    });

    expect(res.success).toBe(false);
    expect(res.applied).toBe(0);
    expect(res.results[0].success).toBe(false);
    expect(res.results[0].error).toContain('no such file');
  });

  it('routes create ops through diff review (user reject stops that op)', async () => {
    await setWorkspaceRoot('/ws');
    registerFileTools();
    const tool = toolRegistry.getTool('apply_patch')!;

    setDiffReviewCallback(async (edit) => {
      // Reject creates, accept updates.
      return { id: edit.id, accepted: edit.kind !== 'write_file' };
    });

    const res = await tool.execute({
      operations: [
        { op: 'update', path: 'a.ts', old_string: 'x', new_string: 'y' },
        { op: 'create', path: 'b.ts', content: 'z' },
      ],
    });

    expect(res.success).toBe(false);
    expect(res.applied).toBe(1);
    const byOp = Object.fromEntries(res.results.map((r: any) => [r.op, r]));
    expect(byOp.update.success).toBe(true);
    expect(byOp.create.success).toBe(false);
  });

  it('rejects an unknown op kind', async () => {
    await setWorkspaceRoot('/ws');
    registerFileTools();
    const tool = toolRegistry.getTool('apply_patch')!;
    const res = await tool.execute({ operations: [{ op: 'bogus', path: 'x' } as any] });
    expect(res.success).toBe(false);
    expect(res.results[0].success).toBe(false);
    expect(res.results[0].error).toContain('Unknown op');
  });
});
