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

describe('Duplicate conversation (#286)', () => {
  it('/duplicate creates a copy in the sidebar', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) {
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"Hello there"}}\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            }),
          },
        } as any;
      }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => screen.getByText('Hello there'), { timeout: 3000 });

    fireEvent.change(composer, { target: { value: '/duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Duplicated conversation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Load session: Copy of /i })).toBeInTheDocument();
  });

  it('the sidebar right-click context menu duplicates a session', async () => {
    const storage = (await import('../services/storage')).storage;
    storage.saveSession({
      id: 's1', title: 'Seed Chat', createdAt: 1, model: 'llama3',
      messages: [{ role: 'user', content: 'seed' }, { role: 'assistant', content: 'reply' }],
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Load session: Seed Chat/i })).toBeInTheDocument());

    // The per-session hover 📑 button is gone — Duplicate now lives in the
    // session row's right-click context menu.
    fireEvent.contextMenu(screen.getByRole('button', { name: /Load session: Seed Chat/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Load session: Copy of Seed Chat/i })).toBeInTheDocument());
  });
});
