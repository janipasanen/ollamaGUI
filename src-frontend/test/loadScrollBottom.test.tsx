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

describe('Scroll to bottom on session load (#258)', () => {
  it('jump-scrolls to the bottom when loading a chat (behavior: auto)', async () => {
    // Pre-populate a session with several messages.
    const storage = (await import('../services/storage')).storage;
    storage.saveSession({
      id: 's1', title: 'Old Chat', createdAt: 1, model: 'llama3:8b',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
        { role: 'assistant', content: 'fourth' },
      ],
    });

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' }) as any;

    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    render(<App />);

    // No session loaded yet -> no jump-scroll for the chat.
    expect(screen.queryByText(/fourth/)).not.toBeInTheDocument();

    // Click the session in the sidebar to load it.
    const sessionBtn = screen.getByRole('button', { name: /Load session: Old Chat/i });
    fireEvent.click(sessionBtn);

    // The latest message is visible, and the end ref was jump-scrolled (behavior: 'auto').
    await waitFor(() => expect(screen.getByText('fourth')).toBeInTheDocument());
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'auto' });
    scrollSpy.mockRestore();
  });

  it('does not show a false new-messages badge when loading a larger chat', async () => {
    const storage = (await import('../services/storage')).storage;
    storage.saveSession({
      id: 's1', title: 'Big Chat', createdAt: 1, model: 'llama3:8b',
      messages: Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` })),
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' }) as any;

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Load session: Big Chat/i }));
    await waitFor(() => expect(screen.getByText('m9')).toBeInTheDocument());
    // No "new messages" badge should be shown for a freshly loaded chat.
    expect(screen.queryByRole('button', { name: /Scroll to bottom.*new messages/i })).not.toBeInTheDocument();
  });
});
