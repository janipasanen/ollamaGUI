import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  gitStatus,
  gitDiff,
  gitStage,
  gitUnstage,
  gitCommit,
  gitLog,
  _mocks,
} from '../services/git';

const CWD = '/workspace/project';

beforeEach(() => {
  _mocks.invoke = null;
});

afterEach(() => {
  _mocks.invoke = null;
});

// ── gitStatus ──────────────────────────────────────────────────────────────────

describe('gitStatus (#103)', () => {
  it('returns staged, unstaged, and untracked lists', async () => {
    _mocks.invoke = async (_cmd, _args) => ({
      staged: ['src/foo.ts'],
      unstaged: ['src/bar.ts'],
      untracked: ['new.txt'],
    });
    const result = await gitStatus(CWD);
    expect(result.staged).toEqual(['src/foo.ts']);
    expect(result.unstaged).toEqual(['src/bar.ts']);
    expect(result.untracked).toEqual(['new.txt']);
  });

  it('passes cwd argument to tauri command', async () => {
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => {
      capturedArgs = args;
      return { staged: [], unstaged: [], untracked: [] };
    };
    await gitStatus(CWD);
    expect(capturedArgs.cwd).toBe(CWD);
  });

  it('calls git_status command', async () => {
    let capturedCmd = '';
    _mocks.invoke = async (cmd, _args) => {
      capturedCmd = cmd;
      return { staged: [], unstaged: [], untracked: [] };
    };
    await gitStatus(CWD);
    expect(capturedCmd).toBe('git_status');
  });
});

// ── gitDiff ────────────────────────────────────────────────────────────────────

describe('gitDiff (#103)', () => {
  it('returns diff string', async () => {
    _mocks.invoke = async () => ({ diff: '--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new' });
    const result = await gitDiff(CWD);
    expect(result.diff).toContain('+new');
  });

  it('passes file parameter when specified', async () => {
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => { capturedArgs = args; return { diff: '' }; };
    await gitDiff(CWD, 'src/foo.ts');
    expect(capturedArgs.file).toBe('src/foo.ts');
  });

  it('passes staged flag', async () => {
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => { capturedArgs = args; return { diff: '' }; };
    await gitDiff(CWD, undefined, true);
    expect(capturedArgs.staged).toBe(true);
  });

  it('defaults staged to false', async () => {
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => { capturedArgs = args; return { diff: '' }; };
    await gitDiff(CWD);
    expect(capturedArgs.staged).toBe(false);
  });
});

// ── gitStage ───────────────────────────────────────────────────────────────────

describe('gitStage (#103)', () => {
  it('passes files array to tauri command', async () => {
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => { capturedArgs = args; return undefined; };
    await gitStage(CWD, ['src/foo.ts', 'src/bar.ts']);
    expect(capturedArgs.files).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('calls git_stage command', async () => {
    let capturedCmd = '';
    _mocks.invoke = async (cmd, _args) => { capturedCmd = cmd; return undefined; };
    await gitStage(CWD, ['file.ts']);
    expect(capturedCmd).toBe('git_stage');
  });
});

// ── gitUnstage ─────────────────────────────────────────────────────────────────

describe('gitUnstage (#103)', () => {
  it('passes files to git_unstage command', async () => {
    let capturedCmd = '';
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (cmd, args) => { capturedCmd = cmd; capturedArgs = args; return undefined; };
    await gitUnstage(CWD, ['src/foo.ts']);
    expect(capturedCmd).toBe('git_unstage');
    expect(capturedArgs.files).toEqual(['src/foo.ts']);
  });
});

// ── gitCommit ──────────────────────────────────────────────────────────────────

describe('gitCommit (#103)', () => {
  it('returns commit hash', async () => {
    _mocks.invoke = async () => ({ hash: 'abc1234' });
    const result = await gitCommit(CWD, 'feat: add feature');
    expect(result.hash).toBe('abc1234');
  });

  it('passes message to tauri command', async () => {
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => { capturedArgs = args; return { hash: 'abc' }; };
    await gitCommit(CWD, 'fix: typo');
    expect(capturedArgs.message).toBe('fix: typo');
  });

  it('calls git_commit command', async () => {
    let capturedCmd = '';
    _mocks.invoke = async (cmd, _args) => { capturedCmd = cmd; return { hash: '123' }; };
    await gitCommit(CWD, 'test');
    expect(capturedCmd).toBe('git_commit');
  });
});

// ── gitLog ─────────────────────────────────────────────────────────────────────

describe('gitLog (#103)', () => {
  const sampleLog = [
    { hash: 'abc1234', author: 'Alice', date: '2024-01-01T12:00:00+00:00', subject: 'Initial commit' },
    { hash: 'def5678', author: 'Bob', date: '2024-01-02T12:00:00+00:00', subject: 'Add feature' },
  ];

  it('returns log entries', async () => {
    _mocks.invoke = async () => sampleLog;
    const result = await gitLog(CWD);
    expect(result).toHaveLength(2);
    expect(result[0].hash).toBe('abc1234');
    expect(result[0].author).toBe('Alice');
    expect(result[0].subject).toBe('Initial commit');
  });

  it('passes n parameter', async () => {
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => { capturedArgs = args; return []; };
    await gitLog(CWD, 5);
    expect(capturedArgs.n).toBe(5);
  });

  it('defaults n to 20', async () => {
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => { capturedArgs = args; return []; };
    await gitLog(CWD);
    expect(capturedArgs.n).toBe(20);
  });

  it('calls git_log command', async () => {
    let capturedCmd = '';
    _mocks.invoke = async (cmd, _args) => { capturedCmd = cmd; return []; };
    await gitLog(CWD);
    expect(capturedCmd).toBe('git_log');
  });
});
