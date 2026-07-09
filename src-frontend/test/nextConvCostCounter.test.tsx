/**
 * Next/prev conversation shortcut (#300), composer word/char counter (#301),
 * and /cost slash command (#302).
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
});

describe('/cost slash command (#302)', () => {
  it('shows token usage and context info', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/cost' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText(/Tokens:.*Context:.*%/)).toBeInTheDocument();
  });
});

describe('Composer word/character counter (#301)', () => {
  it('shows word and char count when typing', () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'hello world foo' } });
    expect(screen.getByText(/3 words · 15 chars/)).toBeInTheDocument();
  });

  it('does not show the counter when the composer is empty', () => {
    render(<App />);
    expect(screen.queryByText(/words · .* chars/)).not.toBeInTheDocument();
  });
});

describe('Next/Previous conversation shortcut (#300)', () => {
  it('switches to the next conversation with Ctrl+]', async () => {
    // Seed two sessions in localStorage
    const sessions = [
      { id: 's1', title: 'First chat', messages: [{ role: 'user', content: 'Hello' }], model: 'llama3', createdAt: Date.now() - 2000 },
      { id: 's2', title: 'Second chat', messages: [{ role: 'user', content: 'World' }], model: 'llama3', createdAt: Date.now() - 1000 },
    ];
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));

    render(<App />);
    // Wait for sessions to load
    await waitFor(() => expect(screen.getByText('Second chat')).toBeInTheDocument(), { timeout: 3000 });
    // Load the first session by clicking it
    const firstBtn = screen.getAllByRole('button', { name: /Load session: First chat/i })[0];
    fireEvent.click(firstBtn);
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument(), { timeout: 3000 });
    // Blur any focused input so isTyping is false
    (document.activeElement as HTMLElement | null)?.blur();
    // Press Ctrl+] to go to next conversation
    fireEvent.keyDown(window, { key: ']', ctrlKey: true });
    await waitFor(() => expect(screen.getByText('World')).toBeInTheDocument(), { timeout: 3000 });
  });
});
