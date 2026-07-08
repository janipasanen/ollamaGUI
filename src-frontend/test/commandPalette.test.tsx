import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette, filterCommands, type PaletteCommand } from '../components/CommandPalette';

const commands: PaletteCommand[] = [
  { id: 'new-chat', label: 'New Chat', hint: 'Ctrl+K', run: vi.fn() },
  { id: 'find', label: 'Find in Chat', hint: 'Ctrl+F', run: vi.fn() },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', hint: 'Ctrl+\\', run: vi.fn() },
  { id: 'open-settings', label: 'Open Settings', hint: 'Ctrl+,', run: vi.fn() },
  { id: 'show-help', label: 'Show Keyboard Shortcuts', hint: '?', run: vi.fn() },
];

describe('filterCommands (#251)', () => {
  it('returns all commands for an empty query', () => {
    expect(filterCommands(commands, '')).toHaveLength(5);
  });
  it('filters case-insensitively by label substring', () => {
    expect(filterCommands(commands, 'toggle')).toHaveLength(1);
    expect(filterCommands(commands, 'TOGGLE')).toHaveLength(1);
    // 'chat' matches both 'New Chat' and 'Find in Chat'
    expect(filterCommands(commands, 'chat')).toHaveLength(2);
  });
  it('returns nothing for a non-matching query', () => {
    expect(filterCommands(commands, 'zzz')).toHaveLength(0);
  });
});

describe('CommandPalette component (#251)', () => {
  it('renders the palette, focuses the input, and lists all commands', () => {
    render(<CommandPalette commands={commands} onClose={() => {}} dark={true} />);
    expect(screen.getByRole('dialog', { name: /Command palette/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Command palette search')).toHaveFocus();
    expect(screen.getByText('New Chat')).toBeInTheDocument();
    expect(screen.getByText('Open Settings')).toBeInTheDocument();
  });

  it('filters the list as the user types', () => {
    render(<CommandPalette commands={commands} onClose={() => {}} dark={false} />);
    fireEvent.change(screen.getByLabelText('Command palette search'), { target: { value: 'settings' } });
    expect(screen.getByText('Open Settings')).toBeInTheDocument();
    expect(screen.queryByText('New Chat')).not.toBeInTheDocument();
  });

  it('shows a no-matches message for an unmatched query', () => {
    render(<CommandPalette commands={commands} onClose={() => {}} dark={true} />);
    fireEvent.change(screen.getByLabelText('Command palette search'), { target: { value: 'zzz' } });
    expect(screen.getByText(/No matching commands/i)).toBeInTheDocument();
  });

  it('ArrowDown/ArrowUp moves the selection and Enter runs the selected command', () => {
    const run = vi.fn();
    const cmds: PaletteCommand[] = [
      { id: 'a', label: 'Alpha', run: vi.fn() },
      { id: 'b', label: 'Beta', run },
      { id: 'c', label: 'Gamma', run: vi.fn() },
    ];
    const onClose = vi.fn();
    render(<CommandPalette commands={cmds} onClose={onClose} dark={true} />);
    const input = screen.getByLabelText('Command palette search');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // Beta selected (index 1)
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<CommandPalette commands={commands} onClose={onClose} dark={true} />);
    fireEvent.keyDown(screen.getByLabelText('Command palette search'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking a command runs it and closes', () => {
    const run = vi.fn();
    const onClose = vi.fn();
    const cmds: PaletteCommand[] = [{ id: 'x', label: 'Execute', run }];
    render(<CommandPalette commands={cmds} onClose={onClose} dark={false} />);
    fireEvent.click(screen.getByText('Execute'));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop closes the palette without running a command', () => {
    const run = vi.fn();
    const onClose = vi.fn();
    const cmds: PaletteCommand[] = [{ id: 'x', label: 'Execute', run }];
    render(<CommandPalette commands={cmds} onClose={onClose} dark={true} />);
    fireEvent.click(screen.getByRole('dialog', { name: /Command palette/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });
});
