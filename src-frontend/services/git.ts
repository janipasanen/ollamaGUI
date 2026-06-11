/**
 * Git integration service (#103).
 *
 * Wraps the Rust git_status / git_diff / git_stage / git_unstage /
 * git_commit / git_log Tauri commands so the git panel and agent tools
 * can operate on the workspace repository.
 */

export interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface GitDiff {
  diff: string;
}

export interface GitCommitResult {
  hash: string;
}

export interface GitLogEntry {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

/** Test seam. */
export const _mocks = {
  invoke: null as ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null,
};

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (_mocks.invoke) return _mocks.invoke(cmd, args) as Promise<T>;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  return tauriInvoke<GitStatus>('git_status', { cwd });
}

export async function gitDiff(cwd: string, file?: string, staged?: boolean): Promise<GitDiff> {
  return tauriInvoke<GitDiff>('git_diff', { cwd, file: file ?? null, staged: staged ?? false });
}

export async function gitStage(cwd: string, files: string[]): Promise<void> {
  return tauriInvoke<void>('git_stage', { cwd, files });
}

export async function gitUnstage(cwd: string, files: string[]): Promise<void> {
  return tauriInvoke<void>('git_unstage', { cwd, files });
}

export async function gitCommit(cwd: string, message: string): Promise<GitCommitResult> {
  return tauriInvoke<GitCommitResult>('git_commit', { cwd, message });
}

export async function gitLog(cwd: string, n?: number): Promise<GitLogEntry[]> {
  return tauriInvoke<GitLogEntry[]>('git_log', { cwd, n: n ?? 20 });
}

// ── Agent tool registration ────────────────────────────────────────────────────

import { toolRegistry } from './tools';

export function registerGitTools(workspaceCwd: string): void {
  toolRegistry.registerTool({
    name: 'git_status',
    description: 'Get the current git status (staged, unstaged, untracked files).',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
    execute: async () => gitStatus(workspaceCwd),
  });

  toolRegistry.registerTool({
    name: 'git_diff',
    description: 'Get the git diff for the working tree or a specific file.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Optional: specific file path to diff' },
        staged: { type: 'string', description: 'If "true", show staged diff' },
      },
    },
    readOnly: true,
    execute: async (p) => gitDiff(workspaceCwd, p.file as string | undefined, p.staged === 'true'),
  });

  toolRegistry.registerTool({
    name: 'git_stage',
    description: 'Stage one or more files for the next commit.',
    parameters: {
      type: 'object',
      properties: {
        files: { type: 'string', description: 'Comma-separated list of file paths to stage' },
      },
      required: ['files'],
    },
    execute: async (p) => {
      const files = (p.files as string).split(',').map((f: string) => f.trim()).filter(Boolean);
      await gitStage(workspaceCwd, files);
      return { staged: files };
    },
  });

  toolRegistry.registerTool({
    name: 'git_commit',
    description: 'Commit all staged changes with the given message.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
      },
      required: ['message'],
    },
    execute: async (p) => gitCommit(workspaceCwd, p.message as string),
  });

  toolRegistry.registerTool({
    name: 'git_log',
    description: 'List recent commits in the repository.',
    parameters: {
      type: 'object',
      properties: {
        n: { type: 'string', description: 'Number of commits to show (default 10)' },
      },
    },
    readOnly: true,
    execute: async (p) => {
      const n = p.n ? parseInt(p.n as string, 10) : 10;
      return { entries: await gitLog(workspaceCwd, n) };
    },
  });
}
