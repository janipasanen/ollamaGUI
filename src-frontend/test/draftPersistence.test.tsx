import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
});

describe('Per-session composer draft persistence (#273)', () => {
  it('restores a session draft after switching away and back', async () => {
    const storage = (await import('../services/storage')).storage;
    storage.saveSession({
      id: 'alpha', title: 'Alpha', createdAt: 1, model: 'llama3',
      messages: [{ role: 'user', content: 'alpha msg' }, { role: 'assistant', content: 'alpha reply' }],
    });
    storage.saveSession({
      id: 'beta', title: 'Beta', createdAt: 2, model: 'llama3',
      messages: [{ role: 'user', content: 'beta msg' }, { role: 'assistant', content: 'beta reply' }],
    });

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    render(<App />);
    const composer = () => screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;

    // Load Alpha and type a draft (don't send).
    fireEvent.click(screen.getByRole('button', { name: /Load session: Alpha/i }));
    await waitFor(() => expect(screen.getByText('alpha reply')).toBeInTheDocument());
    fireEvent.change(composer(), { target: { value: 'draft alpha' } });
    expect(composer().value).toBe('draft alpha');

    // Switch to Beta — its composer should be empty (no saved draft).
    fireEvent.click(screen.getByRole('button', { name: /Load session: Beta/i }));
    await waitFor(() => expect(screen.getByText('beta reply')).toBeInTheDocument());
    expect(composer().value).toBe('');

    // Switch back to Alpha — the draft is restored.
    fireEvent.click(screen.getByRole('button', { name: /Load session: Alpha/i }));
    await waitFor(() => expect(screen.getByText('alpha reply')).toBeInTheDocument());
    expect(composer().value).toBe('draft alpha');
  });
});
