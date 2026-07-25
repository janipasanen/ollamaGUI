import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SourceControlPanel, { registerSourceControlPanel } from '../components/SourceControlPanel';
import { _mocks as gitMocks } from '../services/git';
import { setWorkspaceRoot, clearWorkspaceRoot, _mocks as fsMocks } from '../services/fileTools';
import { panelRegistry } from '../components/PanelShell';

beforeEach(async () => {
  gitMocks.invoke = null;
  fsMocks.invoke = async () => undefined; // set_workspace_root
  await setWorkspaceRoot('/w');
});
afterEach(() => {
  gitMocks.invoke = null;
  fsMocks.invoke = null;
  clearWorkspaceRoot();
});

describe('SourceControlPanel (#434)', () => {
  it('lists staged, changed and untracked files from git_status', async () => {
    gitMocks.invoke = async (cmd) => {
      if (cmd === 'git_status') return { staged: ['a.ts'], unstaged: ['b.ts'], untracked: ['c.ts'] };
      throw new Error('unexpected ' + cmd);
    };
    render(<SourceControlPanel dark={false} />);
    await waitFor(() => expect(screen.getByText('a.ts')).toBeInTheDocument());
    expect(screen.getByText('b.ts')).toBeInTheDocument();
    expect(screen.getByText('c.ts')).toBeInTheDocument();
    expect(screen.getByTestId('scm-section-staged')).toBeInTheDocument();
  });

  it('shows a diff when a file is clicked', async () => {
    gitMocks.invoke = async (cmd) => {
      if (cmd === 'git_status') return { staged: [], unstaged: ['b.ts'], untracked: [] };
      if (cmd === 'git_diff') return { diff: '@@ -1 +1 @@\n-old\n+new' };
      throw new Error('unexpected ' + cmd);
    };
    render(<SourceControlPanel dark={false} />);
    await waitFor(() => expect(screen.getByText('b.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByText('b.ts'));
    await waitFor(() => expect(screen.getByText('+new')).toBeInTheDocument());
    expect(screen.getByText('-old')).toBeInTheDocument();
  });

  it('stages an unstaged file', async () => {
    const calls: string[] = [];
    gitMocks.invoke = async (cmd) => {
      calls.push(cmd);
      if (cmd === 'git_status') return { staged: [], unstaged: ['b.ts'], untracked: [] };
      if (cmd === 'git_stage') return undefined;
      return undefined;
    };
    render(<SourceControlPanel dark={false} />);
    await waitFor(() => expect(screen.getByText('b.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Stage b.ts'));
    await waitFor(() => expect(calls).toContain('git_stage'));
  });

  it('surfaces a stage failure in an alert instead of swallowing it (#441)', async () => {
    gitMocks.invoke = async (cmd) => {
      if (cmd === 'git_status') return { staged: [], unstaged: ['b.ts'], untracked: [] };
      if (cmd === 'git_stage') throw new Error('index.lock exists');
      return undefined;
    };
    render(<SourceControlPanel dark={false} />);
    await waitFor(() => expect(screen.getByText('b.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Stage b.ts'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Stage failed for b.ts/));
    expect(screen.getByRole('alert')).toHaveTextContent(/index.lock/);
  });

  it('shows a loading placeholder instead of a stale diff while fetching (#442)', async () => {
    let resolveDiff: (v: any) => void = () => {};
    gitMocks.invoke = async (cmd) => {
      if (cmd === 'git_status') return { staged: [], unstaged: ['b.ts'], untracked: [] };
      if (cmd === 'git_diff') return new Promise((res) => { resolveDiff = res; });
      return undefined;
    };
    render(<SourceControlPanel dark={false} />);
    await waitFor(() => expect(screen.getByText('b.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByText('b.ts'));
    await waitFor(() => expect(screen.getByText(/Loading diff…/)).toBeInTheDocument());
    resolveDiff({ diff: '+done' });
    await waitFor(() => expect(screen.getByText('+done')).toBeInTheDocument());
  });

  it('shows "Working tree clean" when there are no changes', async () => {
    gitMocks.invoke = async () => ({ staged: [], unstaged: [], untracked: [] });
    render(<SourceControlPanel dark={false} />);
    await waitFor(() => expect(screen.getByText(/Working tree clean/)).toBeInTheDocument());
  });

  it('registers into the panel registry', () => {
    registerSourceControlPanel();
    expect(panelRegistry.list().map((p: any) => p.id)).toContain('source-control');
  });
});
