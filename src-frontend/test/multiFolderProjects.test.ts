import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { projectRoots, openWorkspaceRoots, loadWorkspaceState } from '../services/workspace';
import { _mocks as fsMocks, clearWorkspaceRoot, getWorkspaceRoots, getWorkspaceRoot } from '../services/fileTools';
import { formatWorkspaceContext } from '../services/workspaceContext';

beforeEach(() => {
  localStorage.clear();
  clearWorkspaceRoot();
  fsMocks.invoke = vi.fn(async () => undefined);
});

afterEach(() => {
  fsMocks.invoke = null;
  vi.clearAllMocks();
});

describe('projectRoots (#492)', () => {
  it('returns nothing for a project with no folders', () => {
    expect(projectRoots(null)).toEqual([]);
    expect(projectRoots({ workspaceRoot: '' })).toEqual([]);
    expect(projectRoots({ workspaceRoot: '', workspaceRoots: [] })).toEqual([]);
  });

  it('falls back to the legacy single root so old projects keep working', () => {
    expect(projectRoots({ workspaceRoot: '/a' })).toEqual(['/a']);
  });

  it('prefers the multi-root list when present', () => {
    expect(projectRoots({ workspaceRoot: '/a', workspaceRoots: ['/a', '/b'] })).toEqual(['/a', '/b']);
  });

  it('de-duplicates and drops blank entries', () => {
    expect(projectRoots({ workspaceRoot: '/a', workspaceRoots: ['/a', '/a', '', '  ', '/b'] }))
      .toEqual(['/a', '/b']);
  });
});

describe('openWorkspaceRoots (#492)', () => {
  it('sends every root to the backend and keeps the first as primary', async () => {
    await openWorkspaceRoots(['/a', '/b', '/c']);
    expect(fsMocks.invoke).toHaveBeenCalledWith('set_workspace_roots', { paths: ['/a', '/b', '/c'] });
    expect(getWorkspaceRoots()).toEqual(['/a', '/b', '/c']);
    // The primary root drives the file tree and recent list.
    expect(getWorkspaceRoot()).toBe('/a');
    expect(loadWorkspaceState().root).toBe('/a');
  });

  it('records only the primary root in the recent list', async () => {
    await openWorkspaceRoots(['/a', '/b']);
    expect(loadWorkspaceState().recentRoots).toEqual(['/a']);
  });

  it('closes the workspace when given no usable folders', async () => {
    await openWorkspaceRoots(['/a']);
    await openWorkspaceRoots(['', '   ']);
    expect(getWorkspaceRoot()).toBeNull();
    expect(loadWorkspaceState().root).toBeNull();
  });
});

describe('workspace context block (#489/#491)', () => {
  it('emits nothing when no workspace is open, so nothing is fabricated', () => {
    expect(formatWorkspaceContext(null)).toBe('');
    expect(formatWorkspaceContext({ root: '', availableClis: [] })).toBe('');
  });

  it('names the project, directory and repo so "this project" resolves', () => {
    const out = formatWorkspaceContext({
      root: '/Users/me/app',
      projectName: 'App',
      gitRemote: 'git@github.com:me/app.git',
      gitBranch: 'main',
      availableClis: [],
    });
    expect(out).toContain('Project: App');
    expect(out).toContain('Working directory: /Users/me/app');
    expect(out).toContain('git@github.com:me/app.git');
    expect(out).toContain('main');
    expect(out).toMatch(/this project/i);
  });

  it('advertises only the CLIs that were actually detected', () => {
    const out = formatWorkspaceContext({ root: '/w', availableClis: ['gh', 'git'] });
    expect(out).toContain('gh issue list');
    expect(out).toContain('`git`');
    expect(out).not.toContain('glab');
  });

  it('omits the CLI section entirely when none are installed', () => {
    const out = formatWorkspaceContext({ root: '/w', availableClis: [] });
    expect(out).not.toMatch(/command-line tools/i);
    expect(out).toContain('Working directory: /w');
  });
});
