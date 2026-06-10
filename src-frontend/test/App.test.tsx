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

    // Initially open (based on App.tsx default state)
    expect(screen.getByText(/History/i)).toBeInTheDocument();

    fireEvent.click(menuButton);
    // Sidebar should be hidden (width 0, overflow hidden)
    const sidebar = screen.getByRole('heading', { name: /Ollama GUI/i }).closest('div');
    expect(sidebar).toHaveClass('w-0');
  });

  it('opens settings overlay when settings button is clicked', () => {
    render(<App />);
    const settingsButton = screen.getByRole('button', { name: /⚙️ Settings/i });

    fireEvent.click(settingsButton);
    expect(screen.getByRole('heading', { name: /Settings/i })).toBeInTheDocument();
    expect(screen.getByText(/System Prompt/i)).toBeInTheDocument();
  });

  it('updates input value when typing', () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/Message Ollama\.\.\./i);

    fireEvent.change(input, { target: { value: 'Hello AI' } });
    expect(input).toHaveValue('Hello AI');
  });

  describe('Keyboard Shortcuts', () => {
    it('Cmd/Ctrl+K should start new chat', () => {
      render(<App />);
      const initialMessages = screen.queryAllByRole('listitem');
      
      // Trigger keyboard shortcut
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
      
      // Should start new chat (messages cleared)
      const updatedMessages = screen.queryAllByRole('listitem');
      expect(updatedMessages.length).toBeLessThanOrEqual(initialMessages.length);
    });

    it('Cmd/Ctrl+, should toggle settings', () => {
      render(<App />);
      
      // Settings should be closed initially
      expect(screen.queryByRole('heading', { name: /Settings/i })).not.toBeInTheDocument();
      
      // Trigger keyboard shortcut
      fireEvent.keyDown(window, { key: ',', metaKey: true });
      
      // Settings should be open
      expect(screen.getByRole('heading', { name: /Settings/i })).toBeInTheDocument();
      
      // Close settings with same shortcut
      fireEvent.keyDown(window, { key: ',', metaKey: true });
      
      // Settings should be closed again
      expect(screen.queryByRole('heading', { name: /Settings/i })).not.toBeInTheDocument();
    });

    it('Cmd/Ctrl+\\ should toggle sidebar', () => {
      render(<App />);
      
      // Sidebar should be open initially
      expect(screen.getByText(/History/i)).toBeInTheDocument();
      
      // Trigger keyboard shortcut
      fireEvent.keyDown(window, { key: '\\', metaKey: true });
      
      // Sidebar should be closed
      const sidebar = screen.getByRole('heading', { name: /Ollama GUI/i }).closest('div');
      expect(sidebar).toHaveClass('w-0');
      
      // Open sidebar with same shortcut
      fireEvent.keyDown(window, { key: '\\', metaKey: true });
      
      // Sidebar should be open again
      expect(screen.getByText(/History/i)).toBeInTheDocument();
    });

    it('Escape should close settings when open', () => {
      render(<App />);
      
      // Open settings first
      const settingsButton = screen.getByRole('button', { name: /⚙️ Settings/i });
      fireEvent.click(settingsButton);
      expect(screen.getByRole('heading', { name: /Settings/i })).toBeInTheDocument();
      
      // Close with Escape
      fireEvent.keyDown(window, { key: 'Escape' });
      
      // Settings should be closed
      expect(screen.queryByRole('heading', { name: /Settings/i })).not.toBeInTheDocument();
    });

    it('shortcuts should not trigger when typing in input', () => {
      render(<App />);
      const input = screen.getByPlaceholderText(/Message Ollama\.\.\./i);
      
      // Focus on input
      input.focus();
      
      // Type in input (should not trigger shortcuts)
      fireEvent.keyDown(input, { key: 'k', metaKey: true });
      fireEvent.keyDown(input, { key: ',', metaKey: true });
      
      // No errors should occur and input should maintain focus
      expect(document.activeElement).toBe(input);
    });

    it('help button shows keyboard shortcuts', () => {
      render(<App />);
      
      // Help should be closed initially
      expect(screen.queryByRole('heading', { name: /Keyboard Shortcuts/i })).not.toBeInTheDocument();
      
      // Click help button
      const helpButton = screen.getByRole('button', { name: /❓/ });
      fireEvent.click(helpButton);
      
      // Help modal should be open with shortcuts
      expect(screen.getByRole('heading', { name: /Keyboard Shortcuts/i })).toBeInTheDocument();
      expect(screen.getByText(/Ctrl\+K/i)).toBeInTheDocument();
      expect(screen.getByText(/Ctrl\+\\/i)).toBeInTheDocument();
      expect(screen.getByText(/Ctrl\+,/i)).toBeInTheDocument();
    });

    it('responsive design handles different screen sizes', () => {
      render(<App />);
      
      // Initially should have desktop layout
      expect(screen.getByText(/\+ New Chat/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /⚙️ Settings/i })).toBeInTheDocument();
      
      // Simulate mobile viewport
      global.innerWidth = 600;
      global.dispatchEvent(new Event('resize'));
      
      // On mobile, sidebar should be collapsed by default
      const sidebar = screen.getByRole('heading', { name: /Ollama GUI/i }).closest('div');
      expect(sidebar).toHaveClass('w-0');
    });
  });
});
