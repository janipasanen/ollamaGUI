import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _mocks as gitMocks } from '../services/git';
import { _mocks as fileMocks, setWorkspaceRoot, clearWorkspaceRoot } from '../services/fileTools';
import {
  loadAutoCommitEdits, saveAutoCommitEdits, makeCommitMessage, autoCommitEdit,
} from '../services/autoCommit';

beforeEach(() => {
  localStorage.clear();
  gitMocks.invoke = null;
  fileMocks.invoke = async (cmd) => { if (cmd === 'set_workspace_root') return undefined; return undefined; };
});

afterEach(() => {
  localStorage.clear();
  gitMocks.invoke = null;
  fileMocks.invoke = null;
  clearWorkspaceRoot();
});

describe('autoCommit setting (#401)', () => {
  it('defaults to false', () => {
    expect(loadAutoCommitEdits()).toBe(false);
  });
  it('round-trips the setting', () => {
    saveAutoCommitEdits(true);
    expect(loadAutoCommitEdits()).toBe(true);
    saveAutoCommitEdits(false);
    expect(loadAutoCommitEdits()).toBe(false);
  });
});

describe('makeCommitMessage (#401)', () => {
  it('uses the label and path', () => {
    expect(makeCommitMessage('src/a.ts', 'update src/a.ts')).toBe('ollama-gui: update src/a.ts — src/a.ts');
  });
  it('falls back to "edit" when label is missing/blank', () => {
    expect(makeCommitMessage('b.ts')).toBe('ollama-gui: edit — b.ts');
    expect(makeCommitMessage('b.ts', '   ')).toBe('ollama-gui: edit — b.ts');
  });
});

describe('autoCommitEdit (#401)', () => {
  it('is a no-op when disabled', async () => {
    const calls: string[] = [];
    gitMocks.invoke = async (cmd) => { calls.push(cmd); return undefined; };
    await setWorkspaceRoot('/ws');
    const res = await autoCommitEdit('a.ts', 'edit a', false);
    expect(res.committed).toBe(false);
    expect(calls).toEqual([]);
  });

  it('stages and commits when enabled with a workspace', async () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    gitMocks.invoke = async (cmd, args) => {
      calls.push({ cmd, args: args ?? {} });
      if (cmd === 'git_commit') return { hash: 'abc123' };
      return undefined;
    };
    await setWorkspaceRoot('/ws');
    const res = await autoCommitEdit('src/a.ts', 'update src/a.ts', true);
    expect(res.committed).toBe(true);
    expect(res.hash).toBe('abc123');
    const cmds = calls.map(c => c.cmd);
    expect(cmds).toEqual(['git_stage', 'git_commit']);
    expect(calls[0].args).toMatchObject({ cwd: '/ws', files: ['src/a.ts'] });
    expect(calls[1].args).toMatchObject({ cwd: '/ws', message: makeCommitMessage('src/a.ts', 'update src/a.ts') });
  });

  it('returns an error when no workspace is open', async () => {
    clearWorkspaceRoot();
    const res = await autoCommitEdit('a.ts', 'edit', true);
    expect(res.committed).toBe(false);
    expect(res.error).toMatch(/no workspace/i);
  });

  it('returns a non-fatal error when git fails (not a repo)', async () => {
    gitMocks.invoke = async () => { throw new Error('not a git repository'); };
    await setWorkspaceRoot('/ws');
    const res = await autoCommitEdit('a.ts', 'edit', true);
    expect(res.committed).toBe(false);
    expect(res.error).toContain('not a git repository');
  });
});
