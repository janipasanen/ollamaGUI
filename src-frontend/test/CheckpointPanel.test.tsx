import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CheckpointPanel, { registerCheckpointPanel } from '../components/CheckpointPanel';
import { createCheckpoint, clearCheckpoints, listCheckpoints } from '../services/checkpoints';
import { _mocks as fsMocks } from '../services/fileTools';
import { panelRegistry } from '../components/PanelShell';

beforeEach(() => {
  clearCheckpoints();
  // read_file returns content (for createCheckpoint), write_file/set_workspace_root ok.
  fsMocks.invoke = async (cmd) => (cmd === 'read_file' ? 'original content' : undefined);
});
afterEach(() => {
  clearCheckpoints();
  fsMocks.invoke = null;
});

describe('CheckpointPanel (#435)', () => {
  it('lists checkpoints with label and file count', async () => {
    await createCheckpoint(['a.ts', 'b.ts'], 'before refactor');
    render(<CheckpointPanel dark={false} />);
    expect(screen.getByText('before refactor')).toBeInTheDocument();
    expect(screen.getByText(/2 files/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no checkpoints', () => {
    render(<CheckpointPanel dark={false} />);
    expect(screen.getByText(/No checkpoints yet/)).toBeInTheDocument();
  });

  it('deletes a checkpoint', async () => {
    await createCheckpoint(['a.ts'], 'cp-to-delete');
    render(<CheckpointPanel dark={false} />);
    expect(screen.getByText('cp-to-delete')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Delete checkpoint cp-to-delete'));
    expect(screen.queryByText('cp-to-delete')).not.toBeInTheDocument();
    expect(listCheckpoints()).toHaveLength(0);
  });

  it('clears all checkpoints (confirmed)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await createCheckpoint(['a.ts'], 'cp1');
    await createCheckpoint(['b.ts'], 'cp2');
    render(<CheckpointPanel dark={false} />);
    fireEvent.click(screen.getByLabelText('Clear all checkpoints'));
    await waitFor(() => expect(screen.getByText(/All checkpoints cleared/)).toBeInTheDocument());
    expect(listCheckpoints()).toHaveLength(0);
    (window.confirm as any).mockRestore?.();
  });

  it('rewinds a checkpoint and reports restored files', async () => {
    await createCheckpoint(['a.ts'], 'snapshot');
    render(<CheckpointPanel dark={false} />);
    fireEvent.click(screen.getByLabelText('Rewind to snapshot'));
    await waitFor(() => expect(screen.getByText(/Rewound 1 file/)).toBeInTheDocument());
  });

  it('registers into the panel registry', () => {
    registerCheckpointPanel();
    expect(panelRegistry.list().map((p: any) => p.id)).toContain('checkpoints');
  });
});
