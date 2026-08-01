import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import WorkspaceChip from '../components/WorkspaceChip';
import NoWorkspaceHint from '../components/NoWorkspaceHint';
import { workspaceLabel } from '../components/useWorkspacePicker';
import { _mocks as fsMocks, clearWorkspaceRoot } from '../services/fileTools';

vi.mock('../services/platform', () => ({
  pickDirectory: vi.fn(async () => '/Users/me/projects/demo'),
}));

beforeEach(() => {
  localStorage.clear();
  // The active root lives in module-level state in fileTools, so it survives
  // between tests in this file — reset it or a test that opened a folder
  // leaks its root into the next one.
  clearWorkspaceRoot();
  // set_workspace_root goes through Tauri; stub it for the jsdom environment.
  fsMocks.invoke = vi.fn(async () => undefined);
});

afterEach(() => {
  fsMocks.invoke = null;
  vi.clearAllMocks();
});

describe('workspaceLabel', () => {
  it('shows the basename of a root and a placeholder when none is open', () => {
    expect(workspaceLabel(null)).toBe('No folder');
    expect(workspaceLabel('/Users/me/projects/demo')).toBe('demo');
    expect(workspaceLabel('C:\\src\\app')).toBe('app');
    // A trailing separator must not yield an empty label.
    expect(workspaceLabel('/Users/me/demo/')).toBe('demo');
  });
});

describe('WorkspaceChip (#481)', () => {
  it('renders a "No folder" affordance when no workspace is open', () => {
    render(<WorkspaceChip dark={false} />);
    expect(screen.getByTestId('workspace-chip')).toHaveTextContent('No folder');
  });

  it('opens a folder through the native picker and then shows its name', async () => {
    render(<WorkspaceChip dark={false} />);
    fireEvent.click(screen.getByTestId('workspace-chip'));
    fireEvent.click(screen.getByText('Open folder…'));
    await waitFor(() => expect(screen.getByTestId('workspace-chip')).toHaveTextContent('demo'));
  });

  it('offers a Close workspace action only once a folder is open', async () => {
    render(<WorkspaceChip dark={false} />);
    fireEvent.click(screen.getByTestId('workspace-chip'));
    expect(screen.queryByText('Close workspace')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Open folder…'));
    await waitFor(() => expect(screen.getByTestId('workspace-chip')).toHaveTextContent('demo'));

    fireEvent.click(screen.getByTestId('workspace-chip'));
    fireEvent.click(screen.getByText('Close workspace'));
    await waitFor(() => expect(screen.getByTestId('workspace-chip')).toHaveTextContent('No folder'));
  });
});

describe('NoWorkspaceHint (#482)', () => {
  it('warns only when agentic mode is on and no folder is open', () => {
    const { rerender } = render(<NoWorkspaceHint dark={false} agentic={false} />);
    expect(screen.queryByTestId('no-workspace-hint')).not.toBeInTheDocument();

    rerender(<NoWorkspaceHint dark={false} agentic={true} />);
    expect(screen.getByTestId('no-workspace-hint')).toBeInTheDocument();
  });

  it('disappears once a folder is opened from the hint itself', async () => {
    render(<NoWorkspaceHint dark={false} agentic={true} />);
    fireEvent.click(screen.getByText('Open folder'));
    await waitFor(() => expect(screen.queryByTestId('no-workspace-hint')).not.toBeInTheDocument());
  });

  it('can be dismissed without opening a folder', () => {
    render(<NoWorkspaceHint dark={false} agentic={true} />);
    fireEvent.click(screen.getByLabelText('Dismiss workspace hint'));
    expect(screen.queryByTestId('no-workspace-hint')).not.toBeInTheDocument();
  });
});
