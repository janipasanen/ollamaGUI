/**
 * M71: Code word-wrap toggle (#336), /copy txt (#337),
 *      archive/delete of sessions (#338 — the bulk-select bar was removed with
 *      the project-first sidebar rewrite; archive and delete survive on the
 *      per-session right-click context menu, so the tests target that surface).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;
let origCreateObjectURL: typeof URL.createObjectURL;

beforeEach(() => {
  origFetch = global.fetch;
  origCreateObjectURL = URL.createObjectURL;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  global.fetch = origFetch;
  URL.createObjectURL = origCreateObjectURL;
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

// ── #336 Code word-wrap toggle ───────────────────────────────────────────────

describe('Code word-wrap toggle (#336)', () => {
  it('renders a Wrap toggle button on code blocks', async () => {
    const fence = String.fromCharCode(96, 96, 96);
    const codeContent = 'Here is code:\n' + fence + 'js\nconst x = 1;\n' + fence;
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 's1', title: 'Code chat', messages: [{ role: 'user', content: 'show code' }, { role: 'assistant', content: codeContent }], model: 'llama3', createdAt: 1000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Code chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Code chat/i })[0]);
    const wrapBtn = await screen.findByLabelText(/word wrap/i, {}, { timeout: 5000 });
    expect(wrapBtn.getAttribute('aria-label')).toBe('Enable word wrap');
  });

  it('toggles word-wrap on click and persists to localStorage', async () => {
    const fence = String.fromCharCode(96, 96, 96);
    const codeContent = fence + 'js\nconst x = 1;\n' + fence;
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 's1', title: 'Wrap chat', messages: [{ role: 'user', content: 'show code' }, { role: 'assistant', content: codeContent }], model: 'llama3', createdAt: 1000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Wrap chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Wrap chat/i })[0]);
    const wrapBtn = await screen.findByLabelText(/word wrap/i, {}, { timeout: 5000 });
    fireEvent.click(wrapBtn);
    await waitFor(() => {
      const toggled = screen.getByLabelText(/word wrap/i);
      expect(toggled.getAttribute('aria-label')).toBe('Disable word wrap');
      expect(toggled).toHaveAttribute('aria-pressed', 'true');
    });
    expect(JSON.parse(localStorage.getItem('ollama_gui_code_wordwrap') ?? 'false')).toBe(true);
  });
});

// ── #337 /copy txt ───────────────────────────────────────────────────────────

describe('/copy txt slash command (#337)', () => {
  it('copies the conversation as plain text to the clipboard', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 's1', title: 'Copy chat', messages: [{ role: 'user', content: 'Hello **world**' }, { role: 'assistant', content: 'Hi there' }], model: 'llama3', createdAt: 1000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Copy chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Copy chat/i })[0]);
    await waitFor(() => expect(screen.getByText('Hi there')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/copy txt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Copied conversation as plain text')).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    const copied = (navigator.clipboard.writeText as any).mock.calls.at(-1)[0] as string;
    expect(copied).toContain('User:');
    expect(copied).toContain('Hello world');
    expect(copied).not.toContain('**');
  });

  it('shows empty message when the conversation is empty', async () => {
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/copy txt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Nothing to copy — the conversation is empty')).toBeInTheDocument();
  });
});

// ── #338 Archive/delete via the session context menu ─────────────────────────
// The bulk-select bar (☑ Select / Archive / Delete) was removed with the
// project-first sidebar rewrite. Archive and delete survive per session on the
// right-click context menu; these tests cover that surface instead.

describe('Archive & delete via session context menu (#338, bulk-select removed)', () => {
  it('no longer offers a bulk select mode', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 's1', title: 'Bulk A', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: 1000 },
      { id: 's2', title: 'Bulk B', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: 2000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Bulk A')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByLabelText('Enter bulk select mode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Select session: Bulk A')).not.toBeInTheDocument();
  });

  it('archives a session from the right-click context menu and hides it from the list', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 's1', title: 'Archive A', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: 1000 },
      { id: 's2', title: 'Archive B', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: 2000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Archive A')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Load session: Archive A' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    // Archived sessions leave the active list (no Archived toggle anymore).
    await waitFor(() => expect(screen.queryByText('Archive A')).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('Archive B')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('ollama_gui_sessions') ?? '[]');
    expect(stored.find((s: any) => s.id === 's1').archived).toBe(true);
    expect(stored.find((s: any) => s.id === 's2').archived).not.toBe(true);
  });

  it('deletes a session from the context menu after confirming the dialog', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 's1', title: 'Delete A', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: 1000 },
      { id: 's2', title: 'Delete B', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: 2000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Delete A')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Load session: Delete A' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    // Confirmation dialog appears; confirm.
    const dialog = await screen.findByRole('dialog', { name: 'Delete chat confirmation' });
    expect(within(dialog).getByText(/"Delete A"/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Delete A')).not.toBeInTheDocument(), { timeout: 3000 });
    const stored = JSON.parse(localStorage.getItem('ollama_gui_sessions') ?? '[]');
    expect(stored.map((s: any) => s.id)).toEqual(['s2']);
  });

  it('cancelling the delete confirmation leaves the session intact', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 's1', title: 'Cancel A', messages: [{ role: 'user', content: 'hi' }], model: 'llama3', createdAt: 1000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByText('Cancel A')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Load session: Cancel A' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete chat confirmation' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete chat confirmation' })).not.toBeInTheDocument());
    expect(screen.getByText('Cancel A')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('ollama_gui_sessions') ?? '[]');
    expect(stored.length).toBe(1);
  });
});
