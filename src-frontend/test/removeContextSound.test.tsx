/**
 * /remove command (#318), context limit warning (#319),
 * and completion sound (#320).
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

describe('/remove slash command (#318)', () => {
  it('rejects with usage hint when no model name is given', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/remove' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Usage: /remove <model-name>')).toBeInTheDocument();
  });

  it('rejects when model is not found', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/remove nonexistent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Model "nonexistent" not found')).toBeInTheDocument();
  });
});

describe('Context limit warning banner (#319)', () => {
  it('shows a warning when context usage exceeds 80%', async () => {
    // Set num_ctx to a very small value so tokens exceed 80% quickly
    localStorage.setItem('ollama_gui_gen_options', JSON.stringify({ num_ctx: 100 }));
    // Seed a session with enough text to exceed 80 tokens
    const longText = 'word '.repeat(120);
    const sessions = [
      { id: 's1', title: 'Long chat', messages: [
        { role: 'user', content: longText },
        { role: 'assistant', content: longText },
      ], model: 'llama3', createdAt: Date.now() },
    ];
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Long chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Long chat/i })[0]);
    await waitFor(() => expect(screen.getByText(/Context window.*% full/)).toBeInTheDocument(), { timeout: 3000 });
  });

  it('can be dismissed', async () => {
    localStorage.setItem('ollama_gui_gen_options', JSON.stringify({ num_ctx: 100 }));
    const longText = 'word '.repeat(120);
    const sessions = [
      { id: 's1', title: 'Long chat', messages: [
        { role: 'user', content: longText },
        { role: 'assistant', content: longText },
      ], model: 'llama3', createdAt: Date.now() },
    ];
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Long chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Long chat/i })[0]);
    const dismissBtn = await waitFor(() => screen.getByRole('button', { name: 'Dismiss context warning' }), { timeout: 3000 });
    fireEvent.click(dismissBtn);
    await waitFor(() => expect(screen.queryByText(/Context window.*% full/)).not.toBeInTheDocument(), { timeout: 2000 });
  });
});

describe('Completion sound settings toggle (#320)', () => {
  it('persists the sound-on-complete setting to localStorage', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    const toggle = await screen.findByRole('switch', { name: 'Play sound on completion' }, { timeout: 3000 });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(localStorage.getItem('ollama_gui_sound_complete')).toBe('true');
    }, { timeout: 2000 });
  });
});
