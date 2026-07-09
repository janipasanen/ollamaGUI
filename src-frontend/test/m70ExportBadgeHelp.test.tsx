/**
 * M70: /export txt (#333), per-session model badge (#334),
 *      slash command reference in help overlay (#335).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;
let origCreateObjectURL: typeof URL.createObjectURL;

beforeEach(() => {
  origFetch = global.fetch;
  origCreateObjectURL = URL.createObjectURL;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
});

afterEach(() => {
  global.fetch = origFetch;
  URL.createObjectURL = origCreateObjectURL;
  localStorage.clear();
  vi.restoreAllMocks();
});

const emptyModels = () =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

// ── #333 /export txt ─────────────────────────────────────────────────────────

describe('/export txt slash command (#333)', () => {
  it('exports the current conversation as a plain-text file', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 's1', title: 'Txt chat', messages: [{ role: 'user', content: 'Hello **world**' }, { role: 'assistant', content: 'Hi there' }], model: 'llama3', createdAt: 1000 },
    ]));
    const captured: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { captured.push(blob); return 'blob:mock'; }) as any;
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Txt chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Txt chat/i })[0]);
    await waitFor(() => expect(screen.getByText('Hi there')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/export txt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Exported conversation as plain text')).toBeInTheDocument();
    expect(captured.length).toBeGreaterThan(0);
    const txtBlob = captured[captured.length - 1];
    expect(txtBlob.type).toBe('text/plain');
  });

  it('shows empty message when the conversation is empty', async () => {
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/export txt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Nothing to export — the conversation is empty')).toBeInTheDocument();
  });
});

// ── #334 Per-session model badge ─────────────────────────────────────────────

describe('Per-session model badge (#334)', () => {
  it('renders the model name in the session row', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 's1', title: 'Badge chat', messages: [{ role: 'user', content: 'Hi' }], model: 'mistral:7b', createdAt: 1000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Badge chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    expect(screen.getByText('mistral:7b')).toBeInTheDocument();
  });

  it('shows a tooltip title with the model name', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 's1', title: 'Tooltip chat', messages: [{ role: 'user', content: 'Hi' }], model: 'qwen2.5', createdAt: 1000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Tooltip chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    expect(screen.getByText('qwen2.5').getAttribute('title')).toBe('Model: qwen2.5');
  });
});

// ── #335 Slash command reference in help overlay ─────────────────────────────

describe('Slash command reference in help overlay (#335)', () => {
  it('lists builtin slash commands when /help is invoked', async () => {
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    // The help overlay should show a Slash Commands section
    expect(await screen.findByText('Slash Commands')).toBeInTheDocument();
    // Several known builtin commands should be listed
    expect(screen.getByText('/clear')).toBeInTheDocument();
    expect(screen.getByText('/params')).toBeInTheDocument();
    expect(screen.getByText('/stats')).toBeInTheDocument();
    expect(screen.getByText('/export')).toBeInTheDocument();
  });
});
