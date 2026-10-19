/**
 * Diagnostics attached to edit results (#670).
 *
 * The model should learn about a broken edit in the same turn. It must not learn
 * about a missing language server, and a failing server must never fail the edit.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerFileTools, _mocks, _diagnostics, setWorkspaceRoot, clearWorkspaceRoot } from '../services/fileTools';
import { toolRegistry } from '../services/tools';

const ROOT = '/workspace';

const writeTool = () => toolRegistry.getTool('write_file')!;
const editTool = () => toolRegistry.getTool('apply_edit')!;

beforeEach(async () => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
  _mocks.invoke = async () => undefined;
  await setWorkspaceRoot(ROOT);
  registerFileTools();
});

afterEach(() => {
  _diagnostics.collect = null;
  _mocks.invoke = null;
  clearWorkspaceRoot();
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
});

const broken = {
  status: 'ok' as const,
  diagnostics: [{ range: { start: { line: 2, character: 0 } }, message: 'Cannot find name x', severity: 1 }],
};

describe('write_file', () => {
  it('appends server diagnostics to the result', async () => {
    _diagnostics.collect = async () => broken;
    const result = await writeTool().execute({ path: 'src/a.ts', content: 'const a = x;' }) as any;
    expect(result.success).toBe(true);
    expect(result.diagnostics).toContain('src/a.ts:3:1 error: Cannot find name x');
  });

  it('sends the written content to the server without re-reading the file', async () => {
    const seen: Array<{ path: string; text?: string }> = [];
    _diagnostics.collect = async (path, _cwd, opts) => { seen.push({ path, text: opts.text }); return { status: 'none' }; };
    await writeTool().execute({ path: 'src/a.ts', content: 'const a = 1;' });
    expect(seen).toEqual([{ path: 'src/a.ts', text: 'const a = 1;' }]);
  });

  it('omits the field when the server reports nothing', async () => {
    _diagnostics.collect = async () => ({ status: 'ok', diagnostics: [] });
    const result = await writeTool().execute({ path: 'src/a.ts', content: 'x' }) as any;
    expect(result).toEqual({ success: true });
  });

  it('stays silent when the server is unavailable', async () => {
    _diagnostics.collect = async () => ({ status: 'unavailable', reason: 'no typescript-language-server' });
    const result = await writeTool().execute({ path: 'src/a.ts', content: 'x' }) as any;
    expect(result).toEqual({ success: true });
  });

  it('does not fail the edit when the diagnostics call throws', async () => {
    _diagnostics.collect = async () => { throw new Error('boom'); };
    const result = await writeTool().execute({ path: 'src/a.ts', content: 'x' }) as any;
    expect(result).toEqual({ success: true });
  });

  it('asks no server for a file type it cannot check', async () => {
    let called = false;
    _diagnostics.collect = async () => { called = true; return broken; };
    const result = await writeTool().execute({ path: 'notes.md', content: '# hi' }) as any;
    expect(called).toBe(false);
    expect(result).toEqual({ success: true });
  });

  it('does nothing when no workspace is open', async () => {
    clearWorkspaceRoot();
    let called = false;
    _diagnostics.collect = async () => { called = true; return broken; };
    const result = await writeTool().execute({ path: 'src/a.ts', content: 'x' }) as any;
    expect(called).toBe(false);
    expect(result).toEqual({ success: true });
  });
});

describe('apply_edit', () => {
  it('reads the edited file back and reports diagnostics', async () => {
    _mocks.invoke = async (cmd) => {
      if (cmd === 'read_file') return 'const a = x;';
      return undefined;
    };
    const seen: Array<string | undefined> = [];
    _diagnostics.collect = async (_path, _cwd, opts) => { seen.push(opts.text); return broken; };

    const result = await editTool().execute({ path: 'src/a.ts', old_string: 'a = 1', new_string: 'a = x' }) as any;
    expect(seen).toEqual(['const a = x;']);
    expect(result.diagnostics).toContain('Cannot find name x');
  });

  it('does not report diagnostics when the edit was declined', async () => {
    let called = false;
    _diagnostics.collect = async () => { called = true; return broken; };
    // No reviewer is registered, but a failed write is simulated by the Rust error.
    _mocks.invoke = async (cmd) => {
      if (cmd === 'read_file') return 'text';
      throw new Error('old_string not found');
    };
    // A failed edit throws (the agent needs the reason), and nothing is checked.
    await expect(editTool().execute({ path: 'src/a.ts', old_string: 'nope', new_string: 'x' }))
      .rejects.toThrow('old_string not found');
    expect(called).toBe(false);
  });
});
