import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _mocks as gitMocks } from '../services/git';
import { _mocks as fileMocks, setWorkspaceRoot, clearWorkspaceRoot } from '../services/fileTools';
import { undoLastAutoCommit, AUTO_COMMIT_PREFIX, makeCommitMessage } from '../services/autoCommit';

beforeEach(() => {
  localStorage.clear();
  gitMocks.invoke = null;
  fileMocks.invoke = async (cmd) => { if (cmd === 'set_workspace_root') return undefined; return undefined; };
});

afterEach(() => {
  gitMocks.invoke = null;
  fileMocks.invoke = null;
  clearWorkspaceRoot();
  localStorage.clear();
});

describe('undoLastAutoCommit (#402)', () => {
  it('refuses without a workspace', async () => {
    clearWorkspaceRoot();
    const res = await undoLastAutoCommit();
    expect(res.reverted).toBe(false);
    expect(res.error).toMatch(/no workspace/i);
  });

  it('resets HEAD~1 when the last commit is an agent auto-commit', async () => {
    const calls: string[] = [];
    gitMocks.invoke = async (cmd) => {
      calls.push(cmd);
      if (cmd === 'git_log') return [{ hash: 'abc12345', author: 'a', date: '2026', subject: makeCommitMessage('src/a.ts', 'update src/a.ts') }];
      return undefined;
    };
    await setWorkspaceRoot('/ws');
    const res = await undoLastAutoCommit();
    expect(res.reverted).toBe(true);
    expect(res.subject).toBe(`ollama-gui: update src/a.ts — src/a.ts`);
    expect(calls).toContain('git_log');
    expect(calls).toContain('git_reset');
  });

  it('refuses when the last commit is NOT an auto-commit', async () => {
    const calls: string[] = [];
    gitMocks.invoke = async (cmd) => {
      calls.push(cmd);
      if (cmd === 'git_log') return [{ hash: 'deadbeef', author: 'a', date: '2026', subject: 'feat: my own commit' }];
      return undefined;
    };
    await setWorkspaceRoot('/ws');
    const res = await undoLastAutoCommit();
    expect(res.reverted).toBe(false);
    expect(res.subject).toBe('feat: my own commit');
    expect(res.error).toMatch(/not an agent auto-commit/i);
    expect(calls).not.toContain('git_reset');
  });

  it('reports "No commits yet" when log is empty', async () => {
    gitMocks.invoke = async (cmd) => { if (cmd === 'git_log') return []; return undefined; };
    await setWorkspaceRoot('/ws');
    const res = await undoLastAutoCommit();
    expect(res.reverted).toBe(false);
    expect(res.error).toMatch(/no commits yet/i);
  });

  it('surfaces git failures non-fatally', async () => {
    gitMocks.invoke = async () => { throw new Error('git not found'); };
    await setWorkspaceRoot('/ws');
    const res = await undoLastAutoCommit();
    expect(res.reverted).toBe(false);
    expect(res.error).toContain('git not found');
  });

  it('AUTO_COMMIT_PREFIX marks auto-commits', () => {
    expect(AUTO_COMMIT_PREFIX).toBe('ollama-gui:');
    expect(makeCommitMessage('a.ts', 'edit').startsWith(AUTO_COMMIT_PREFIX)).toBe(true);
  });
});
