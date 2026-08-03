import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

describe('In-conversation search integration (#247)', () => {
  it('Cmd/Ctrl+F opens the search bar even while typing in the chat input', () => {
    render(<App />);
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    const input = screen.getByPlaceholderText(/Message Ollama\.\.\./i);
    input.focus();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('Search query')).toHaveFocus();
  });

  it('Escape closes the search bar', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(screen.getByRole('search')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });

  it('toggling Cmd/Ctrl+F again closes the search bar', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(screen.getByRole('search')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });
});

describe('Keyboard shortcuts overlay completeness (#248)', () => {
  it('lists all wired shortcuts including browser, files, terminal, and find', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByRole('heading', { name: /Keyboard Shortcuts/i })).toBeInTheDocument();
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+F')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+B')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Shift+F')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+T')).toBeInTheDocument();
    expect(screen.getByText(/Find in Chat/i)).toBeInTheDocument();
    expect(screen.getByText(/Toggle Browser/i)).toBeInTheDocument();
    expect(screen.getByText(/Toggle Files/i)).toBeInTheDocument();
    expect(screen.getByText(/Toggle Terminal/i)).toBeInTheDocument();
  });
});
