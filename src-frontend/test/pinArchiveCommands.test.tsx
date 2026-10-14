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

function streamReply(content: string) {
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: Buffer.from(`{"message":{"content":"${content}"}}\n`) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }),
    },
  } as any;
}

describe('/pin slash command (#282)', () => {
  it('pins then unpins the current conversation', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) return streamReply('Hello there');
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => screen.getByText('Hello there'), { timeout: 3000 });

    fireEvent.change(composer, { target: { value: '/pin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Pinned conversation')).toBeInTheDocument();
    // The nested sidebar row shows a 📌 prefix on the title while pinned.
    await waitFor(() => {
      const row = screen.getAllByRole('button', { name: /Load session: /i })[0];
      expect(row.textContent).toContain('📌');
    });

    fireEvent.change(composer, { target: { value: '/pin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Unpinned conversation')).toBeInTheDocument();
    await waitFor(() => {
      const row = screen.getAllByRole('button', { name: /Load session: /i })[0];
      expect(row.textContent).not.toContain('📌');
    });
  });
});

describe('/archive slash command (#283)', () => {
  it('archives the current conversation', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) return streamReply('Hello there');
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => screen.getByText('Hello there'), { timeout: 3000 });

    fireEvent.change(composer, { target: { value: '/archive' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Archived conversation')).toBeInTheDocument();
    // Archived sessions disappear from the sidebar (no Archived toggle anymore).
    await waitFor(() => expect(screen.queryByRole('button', { name: /Load session: /i })).not.toBeInTheDocument());
  });
});
