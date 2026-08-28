import { describe, it, expect, vi } from 'vitest';
import {
  formatWorkspaceContext,
  detectGitInfo,
  detectRepoClis,
  REPO_CLIS,
} from '../services/workspaceContext';

describe('formatWorkspaceContext (#489/#491)', () => {
  it('returns "" when there is no workspace (ctx null)', () => {
    expect(formatWorkspaceContext(null)).toBe('');
  });

  it('returns "" when the workspace root is empty', () => {
    expect(formatWorkspaceContext({ root: '', availableClis: [] })).toBe('');
  });

  it('emits the workspace block with the working directory only', () => {
    const out = formatWorkspaceContext({ root: '/home/user/project', availableClis: [] });
    expect(out).toBe(
      [
        '--- Workspace ---',
        'Working directory: /home/user/project',
        '',
        'When the user says "this project", "this repo", or "here", they mean the working directory above.',
        'File, search and Git tools operate inside it — read the actual files rather than guessing or asking which project is meant.',
        '---',
      ].join('\n'),
    );
  });

  it('includes the project name and git remote/branch when present', () => {
    const out = formatWorkspaceContext({
      root: '/home/user/project',
      projectName: 'ollamaGUI',
      gitRemote: 'https://github.com/janipasanen/ollamaGUI.git',
      gitBranch: 'macOS-10.15',
      availableClis: [],
    });
    expect(out).toContain('Project: ollamaGUI');
    expect(out).toContain('Git remote: https://github.com/janipasanen/ollamaGUI.git');
    expect(out).toContain('Git branch: macOS-10.15');
  });

  it('advertises known CLIs with their hints and drops unknown ones', () => {
    const out = formatWorkspaceContext({
      root: '/p',
      availableClis: ['gh', 'glab', 'not-a-cli'],
    });
    expect(out).toContain('`gh` (GitHub CLI)');
    expect(out).toContain('`glab` (GitLab CLI)');
    expect(out).not.toContain('not-a-cli');
  });

  it('omits the CLIs section when none are known', () => {
    const out = formatWorkspaceContext({ root: '/p', availableClis: [] });
    expect(out).not.toContain('command-line tools');
  });

  it('does not advertise CLIs that exist but have no hint', () => {
    const out = formatWorkspaceContext({ root: '/p', availableClis: ['some-cli'] });
    expect(out).not.toContain('command-line tools');
  });
});

describe('detectGitInfo (#489/#491)', () => {
  it('reads remote and branch from the injected run fn', async () => {
    const run = vi.fn(async (cmd: string) => {
      if (cmd === 'git remote get-url origin') {
        return { stdout: 'https://github.com/a/b.git\n', exit_code: 0 };
      }
      if (cmd === 'git rev-parse --abbrev-ref HEAD') {
        return { stdout: 'main', exit_code: 0 };
      }
      return { stdout: '', exit_code: 128 };
    });
    const info = await detectGitInfo('/repo', run);
    expect(info).toEqual({
      gitRemote: 'https://github.com/a/b.git',
      gitBranch: 'main',
    });
  });

  it('treats non-zero exit codes as no remote/branch', async () => {
    const run = vi.fn(async () => ({ stdout: '', exit_code: 128 }));
    const info = await detectGitInfo('/repo', run);
    expect(info).toEqual({});
  });

  it('passes the workspace root as cwd to the run fn', async () => {
    const run = vi.fn(async () => ({ stdout: '', exit_code: 128 }));
    await detectGitInfo('/work/root', run);
    expect(run).toHaveBeenCalledWith('git remote get-url origin', '/work/root');
    expect(run).toHaveBeenCalledWith('git rev-parse --abbrev-ref HEAD', '/work/root');
  });

  it('returns {} when runCliOnce import fails', async () => {
    const info = await detectGitInfo('/repo');
    expect(info).toEqual({});
  });
});

describe('detectRepoClis (#489/#491)', () => {
  it('returns [] when probeOnce import fails (outside Tauri)', async () => {
    expect(await detectRepoClis()).toEqual([]);
  });

  it('lists only CLIs the probe reports as present, in REPO_CLIS order', async () => {
    const probe = vi.fn(async (name: string) => name === 'git');
    expect(await detectRepoClis(probe)).toEqual(['git']);
  });

  it('filters in REPO_CLIS order across multiple present CLIs', async () => {
    const probe = vi.fn(async (_name: string) => true);
    expect(await detectRepoClis(probe)).toEqual([...REPO_CLIS]);
  });

  it('ignores probes that throw', async () => {
    const probe = vi.fn(async (_name: string) => {
      throw new Error('boom');
    });
    expect(await detectRepoClis(probe)).toEqual([]);
  });
});
