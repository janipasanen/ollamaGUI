import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette, filterCommands, type PaletteCommand } from '../components/CommandPalette';

// ── #479: additional CommandPalette UI usability coverage ────────────────────

const cmds: PaletteCommand[] = [
  { id: 'new', label: 'New Chat', hint: 'Ctrl+N', run: vi.fn() },
  { id: 'search', label: 'Search Conversations', hint: 'Ctrl+F', run: vi.fn() },
  { id: 'settings', label: 'Open Settings', run: vi.fn() },
  { id: 'regen', label: 'Regenerate Last Reply', hint: 'Ctrl+R', run: vi.fn() },
];

describe('CommandPalette usability extras (#479)', () => {
  it('renders the dialog with correct aria attributes', () => {
    render(<CommandPalette commands={cmds} onClose={vi.fn()} dark={true} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Command palette');
  });

  it('shows hint text for commands that have one', () => {
    render(<CommandPalette commands={cmds} onClose={vi.fn()} dark={false} />);
    expect(screen.getByText('Ctrl+N')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+F')).toBeInTheDocument();
  });

  it('does not show hint for commands without one', () => {
    render(<CommandPalette commands={cmds} onClose={vi.fn()} dark={true} />);
    // 'Open Settings' has no hint
    const settingsBtn = screen.getByText('Open Settings').closest('button');
    expect(settingsBtn?.querySelector('kbd')).toBeNull();
  });

  it('ArrowDown twice then Enter runs the third command', () => {
    const run = vi.fn();
    const localCmds: PaletteCommand[] = [
      { id: 'a', label: 'Alpha', run: vi.fn() },
      { id: 'b', label: 'Beta', run: vi.fn() },
      { id: 'c', label: 'Gamma', run },
    ];
    const onClose = vi.fn();
    render(<CommandPalette commands={localCmds} onClose={onClose} dark={true} />);
    const input = screen.getByLabelText('Command palette search');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ArrowUp does not go above index 0', () => {
    const run = vi.fn();
    const localCmds: PaletteCommand[] = [
      { id: 'a', label: 'Alpha', run },
      { id: 'b', label: 'Beta', run: vi.fn() },
    ];
    render(<CommandPalette commands={localCmds} onClose={vi.fn()} dark={true} />);
    const input = screen.getByLabelText('Command palette search');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).toHaveBeenCalledTimes(1); // still on index 0 = Alpha
  });

  it('filterCommands handles whitespace-only query as empty', () => {
    expect(filterCommands(cmds, '   ')).toHaveLength(4);
  });

  it('clicking a command button runs it and closes', () => {
    const run = vi.fn();
    const onClose = vi.fn();
    const localCmds: PaletteCommand[] = [
      { id: 'a', label: 'Alpha', run: vi.fn() },
      { id: 'b', label: 'Beta', run },
    ];
    render(<CommandPalette commands={localCmds} onClose={onClose} dark={false} />);
    fireEvent.click(screen.getByText('Beta'));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('MouseEnter on a command updates the selected index', () => {
    const run = vi.fn();
    const localCmds: PaletteCommand[] = [
      { id: 'a', label: 'Alpha', run: vi.fn() },
      { id: 'b', label: 'Beta', run },
    ];
    render(<CommandPalette commands={localCmds} onClose={vi.fn()} dark={true} />);
    const betaBtn = screen.getByText('Beta').closest('button')!;
    fireEvent.mouseEnter(betaBtn);
    fireEvent.keyDown(screen.getByLabelText('Command palette search'), { key: 'Enter' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
