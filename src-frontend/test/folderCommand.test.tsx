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

describe('/folder slash command (#288)', () => {
  it('creates the folder and moves the current conversation into it', async () => {
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

    fireEvent.change(composer, { target: { value: '/folder Work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Moved conversation to folder "Work"')).toBeInTheDocument();

    // Folder chips are gone from the sidebar; the folder lives on in storage
    // and the session is filed under it.
    const folders = JSON.parse(localStorage.getItem('ollama_gui_folders') ?? '[]') as Array<{ id: string; name: string }>;
    const work = folders.find(f => f.name === 'Work');
    expect(work).toBeTruthy();
    const sessions = JSON.parse(localStorage.getItem('ollama_gui_sessions') ?? '[]') as Array<{ folderId?: string }>;
    expect(sessions.some(s => s.folderId === work!.id)).toBe(true);

    // The surviving UI surface: sidebar search matches folder names.
    const search = screen.getByLabelText('Search conversations');
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Load session: /i })).not.toBeInTheDocument());
    fireEvent.change(search, { target: { value: 'Work' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Load session: /i })).toBeInTheDocument());
  });

  it('shows a usage hint with no argument', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/folder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Usage: /folder <name>')).toBeInTheDocument();
  });
});
