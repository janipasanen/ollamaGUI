import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

describe('Command palette integration (#251)', () => {
  it('Cmd/Ctrl+P opens the command palette even while typing in the chat input', () => {
    render(<App />);
    expect(screen.queryByRole('dialog', { name: /Command palette/i })).not.toBeInTheDocument();
    const input = screen.getByPlaceholderText(/Message Ollama\.\.\./i);
    input.focus();
    fireEvent.keyDown(window, { key: 'p', metaKey: true });
    expect(screen.getByRole('dialog', { name: /Command palette/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Command palette search')).toHaveFocus();
  });

  it('Escape closes the command palette', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: /Command palette/i })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /Command palette/i })).not.toBeInTheDocument();
  });

  it('opening the palette and choosing Open Settings opens settings', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p', metaKey: true });
    expect(screen.queryByRole('heading', { name: /^Settings$/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Command palette search'), { target: { value: 'settings' } });
    fireEvent.click(screen.getByText('Open Settings'));
    expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Command palette/i })).not.toBeInTheDocument();
  });

  it('the keyboard-shortcuts overlay lists the Command Palette entry', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Show keyboard shortcuts/i }));
    expect(screen.getByText('Command Palette')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+P')).toBeInTheDocument();
  });
});
