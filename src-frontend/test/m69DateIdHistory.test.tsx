/**
 * M69: Date-grouped sidebar (#330), /id command (#331),
 *      prompt history navigation Alt+Up/Alt+Down (#332).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;
const DAY = 86_400_000;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  vi.restoreAllMocks();
});

const emptyModels = () =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

const streamFetch = (reply: string) =>
  vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes('/api/chat')) {
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: Buffer.from(JSON.stringify({ message: { content: reply } }) + '\n') })
              .mockResolvedValueOnce({ done: true, value: undefined }),
          }),
        },
      } as any;
    }
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });

// ── #330 Date-grouped conversation list ──────────────────────────────────────

describe('Date-grouped conversation list (#330)', () => {
  it('shows Today / Yesterday / Previous 7 Days / Older section labels', async () => {
    const now = Date.now();
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 'today', title: 'Today chat', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: now - 1000 },
      { id: 'yesterday', title: 'Yesterday chat', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: now - DAY - 1000 },
      { id: 'prev7', title: 'Prev7 chat', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: now - 4 * DAY },
      { id: 'older', title: 'Older chat', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: now - 60 * DAY },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Today chat')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.getByText('Previous 7 Days')).toBeInTheDocument();
    expect(screen.getByText('Older')).toBeInTheDocument();
  });

  it('shows a Pinned section label above pinned sessions', async () => {
    const now = Date.now();
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 'p1', title: 'Pinned chat', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: now - 1000, pinned: true },
      { id: 't1', title: 'Normal chat', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: now - 2000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load session: Pinned chat' })).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('Pinned')).toBeInTheDocument();
  });

  it('does not show date labels when sorted by name', async () => {
    const now = Date.now();
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 'today', title: 'Today chat', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: now - 1000 },
      { id: 'older', title: 'Older chat', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: now - 60 * DAY },
    ]));
    localStorage.setItem('ollama_gui_sort_mode', 'name');
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Today chat')).toBeInTheDocument(), { timeout: 3000 });
    // When sorted by name, no date-bucket labels should appear
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
    expect(screen.queryByText('Older')).not.toBeInTheDocument();
  });
});

// ── #331 /id slash command ───────────────────────────────────────────────────

describe('/id slash command (#331)', () => {
  it('shows and copies the current session ID after loading a session', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 'sess-abc-123', title: 'ID chat', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: 1000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByText('ID chat')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'Load session: ID chat' }));
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    const banner = await screen.findByText(/Session ID: sess-abc-123/);
    expect(banner.textContent).toContain('copied to clipboard');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sess-abc-123');
  });

  it('reports no active session when temporary', async () => {
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('No active session — start a chat first')).toBeInTheDocument();
  });
});

// ── #332 Prompt history navigation (Alt+Up/Alt+Down) ─────────────────────────

describe('Prompt history navigation (#332)', () => {
  it('Alt+Up recalls the last sent prompt into the composer', async () => {
    global.fetch = streamFetch('Hello there');
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    // Wait for the assistant reply to appear
    await waitFor(() => expect(screen.getByText('Hello there')).toBeInTheDocument(), { timeout: 3000 });
    // Composer should be cleared after send
    expect(composer.value).toBe('');
    // Alt+Up recalls the last prompt
    fireEvent.keyDown(composer, { key: 'ArrowUp', altKey: true });
    expect(composer.value).toBe('Hi');
  });

  it('Alt+Down moves forward and clears the composer past the newest entry', async () => {
    global.fetch = streamFetch('Reply one');
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'first prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByText('Reply one')).toBeInTheDocument(), { timeout: 3000 });
    expect(composer.value).toBe('');
    // Alt+Up recalls
    fireEvent.keyDown(composer, { key: 'ArrowUp', altKey: true });
    expect(composer.value).toBe('first prompt');
    // Alt+Down moves forward past newest → clears
    fireEvent.keyDown(composer, { key: 'ArrowDown', altKey: true });
    expect(composer.value).toBe('');
  });

  it('Alt+Up does nothing when there is no history', async () => {
    global.fetch = emptyModels();
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    await waitFor(() => expect(composer).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.keyDown(composer, { key: 'ArrowUp', altKey: true });
    expect(composer.value).toBe('');
  });
});
