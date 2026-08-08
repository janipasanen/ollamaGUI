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

describe('/tag slash command (#285)', () => {
  it('adds a tag to the current conversation', async () => {
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

    fireEvent.change(composer, { target: { value: '/tag work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Tagged conversation with "work"')).toBeInTheDocument();

    // Tag chips are gone from the sidebar rows; the tag persists on the
    // session and is reachable through sidebar search, which matches tags.
    const sessions = JSON.parse(localStorage.getItem('ollama_gui_sessions') ?? '[]') as Array<{ tags?: string[] }>;
    expect(sessions.some(s => (s.tags ?? []).includes('work'))).toBe(true);

    const search = screen.getByLabelText('Search conversations');
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Load session: /i })).not.toBeInTheDocument());
    fireEvent.change(search, { target: { value: 'work' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Load session: /i })).toBeInTheDocument());
  });

  it('shows a usage hint with no argument', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) {
        return {
          ok: true,
          body: { getReader: () => ({ read: vi.fn().mockResolvedValueOnce({ done: true }) }) },
        } as any;
      }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(composer.value).toBe(''));

    fireEvent.change(composer, { target: { value: '/tag' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Usage: /tag <name>')).toBeInTheDocument();
  });
});
