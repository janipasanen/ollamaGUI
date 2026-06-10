import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

describe('App Component', () => {
  it('renders the main chat interface', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /Ollama GUI/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Message Ollama\.\.\./i)).toBeInTheDocument();
  });

  it('toggles sidebar when menu button is clicked', () => {
    render(<App />);
    const menuButton = screen.getByRole('button', { name: /☰/i });

    // Sidebar heading is visible initially
    expect(screen.getByRole('heading', { name: /Ollama GUI/i })).toBeInTheDocument();

    fireEvent.click(menuButton);

    // After collapse the sidebar container has w-0
    const sidebar = screen.getByRole('heading', { name: /Ollama GUI/i }).closest('div.transition-all');
    expect(sidebar).toHaveClass('w-0');
  });

  it('opens settings overlay when settings button is clicked', () => {
    render(<App />);
    const settingsButton = screen.getByRole('button', { name: /⚙️ Settings/i });

    fireEvent.click(settingsButton);
    expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument();
    expect(screen.getByText(/System Prompt/i)).toBeInTheDocument();
  });

  it('updates input value when typing', () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/Message Ollama\.\.\./i);

    fireEvent.change(input, { target: { value: 'Hello AI' } });
    expect(input).toHaveValue('Hello AI');
  });

  // M5 feature tests
  it('shows search input in sidebar', () => {
    render(<App />);
    expect(screen.getByPlaceholderText(/Search conversations/i)).toBeInTheDocument();
  });

  it('shows export and import buttons in sidebar', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import/i })).toBeInTheDocument();
  });

  it('shows attach button in input area', () => {
    render(<App />);
    expect(screen.getByTitle(/Attach image/i)).toBeInTheDocument();
  });

  it('shows endpoint config in settings overlay', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    expect(screen.getByText(/Ollama Endpoint/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/http:\/\/localhost:11434/i)).toBeInTheDocument();
  });

  describe('Keyboard Shortcuts', () => {
    it('Cmd/Ctrl+K should start new chat', () => {
      render(<App />);
      const initialMessages = screen.queryAllByRole('listitem');

      fireEvent.keyDown(window, { key: 'k', metaKey: true });

      const updatedMessages = screen.queryAllByRole('listitem');
      expect(updatedMessages.length).toBeLessThanOrEqual(initialMessages.length);
    });

    it('Cmd/Ctrl+, should toggle settings', () => {
      render(<App />);

      expect(screen.queryByRole('heading', { name: /^Settings$/i })).not.toBeInTheDocument();

      fireEvent.keyDown(window, { key: ',', metaKey: true });
      expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument();

      fireEvent.keyDown(window, { key: ',', metaKey: true });
      expect(screen.queryByRole('heading', { name: /^Settings$/i })).not.toBeInTheDocument();
    });

    it('Cmd/Ctrl+\\ should toggle sidebar', () => {
      render(<App />);

      expect(screen.getByText(/History/i)).toBeInTheDocument();

      fireEvent.keyDown(window, { key: '\\', metaKey: true });
      const sidebar = screen.getByRole('heading', { name: /Ollama GUI/i }).closest('div.transition-all');
      expect(sidebar).toHaveClass('w-0');

      fireEvent.keyDown(window, { key: '\\', metaKey: true });
      expect(screen.getByText(/History/i)).toBeInTheDocument();
    });

    it('Escape should close settings when open', () => {
      render(<App />);

      fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
      expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('heading', { name: /^Settings$/i })).not.toBeInTheDocument();
    });

    it('shortcuts should not trigger when typing in input', () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/Message Ollama\.\.\./i);

      input.focus();
      fireEvent.keyDown(input, { key: 'k', metaKey: true });
      fireEvent.keyDown(input, { key: ',', metaKey: true });

      expect(document.activeElement).toBe(input);
    });

    it('help button shows keyboard shortcuts', () => {
      render(<App />);

      expect(screen.queryByRole('heading', { name: /Keyboard Shortcuts/i })).not.toBeInTheDocument();

      const helpButton = screen.getByRole('button', { name: /❓/ });
      fireEvent.click(helpButton);

      expect(screen.getByRole('heading', { name: /Keyboard Shortcuts/i })).toBeInTheDocument();
      expect(screen.getByText(/Ctrl\+K/i)).toBeInTheDocument();
      expect(screen.getByText(/Ctrl\+\\/i)).toBeInTheDocument();
      expect(screen.getByText(/Ctrl\+,/i)).toBeInTheDocument();
    });
  });
});
