/**
 * Zen mode (#309), notification permission (#310), and /delete command (#311).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Zen/Focus mode (#309)', () => {
  it('toggles zen mode with Ctrl+Shift+Z and hides the sidebar', async () => {
    render(<App />);
    // Sidebar should be visible initially
    const sidebarSearch = screen.getByPlaceholderText('Search conversations...');
    expect(sidebarSearch).toBeInTheDocument();
    // Blur any focused input so isTyping is false
    (document.activeElement as HTMLElement | null)?.blur();
    // Toggle zen mode
    fireEvent.keyDown(window, { key: 'Z', shiftKey: true, ctrlKey: true });
    // Sidebar container should have w-0 class (zen mode hides it)
    await waitFor(() => {
      const sidebarContainer = sidebarSearch.closest('div.transition-all');
      expect(sidebarContainer?.className).toContain('w-0');
    }, { timeout: 2000 });
    // Toggle back
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: 'Z', shiftKey: true, ctrlKey: true });
    await waitFor(() => {
      const sidebarContainer = sidebarSearch.closest('div.transition-all');
      expect(sidebarContainer?.className).toContain('w-64');
    }, { timeout: 2000 });
  });
});

describe('Notification permission toggle (#310)', () => {
  it('persists the notify-on-complete setting to localStorage', async () => {
    render(<App />);
    // Open settings with Ctrl+,
    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    // Wait for settings to open and find the toggle
    const toggle = await screen.findByRole('switch', { name: 'Notify on completion' }, { timeout: 3000 });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(localStorage.getItem('ollama_gui_notify_complete')).toBe('true');
    }, { timeout: 2000 });
  });
});

describe('/delete slash command (#311)', () => {
  it('rejects when there is no current conversation', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/delete' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('No conversation to delete')).toBeInTheDocument();
  });

  it('opens the delete confirmation for the current conversation', async () => {
    const sessions = [
      { id: 's1', title: 'Test chat', messages: [{ role: 'user', content: 'Hi' }], model: 'llama3', createdAt: Date.now() },
    ];
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Test chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Test chat/i })[0]);
    await waitFor(() => expect(screen.getByText('Hi')).toBeInTheDocument(), { timeout: 2000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/delete' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByText(/permanently delete/)).toBeInTheDocument(), { timeout: 3000 });
  });
});
