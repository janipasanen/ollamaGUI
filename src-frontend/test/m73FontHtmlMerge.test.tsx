/**
 * M73: Font zoom (#342), /export html (#343), /merge (#344).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;
let origCreateObjectURL: typeof URL.createObjectURL;
let origRootFontSize: string;

beforeEach(() => {
  origFetch = global.fetch;
  origCreateObjectURL = URL.createObjectURL;
  origRootFontSize = document.documentElement.style.fontSize;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
});

afterEach(() => {
  global.fetch = origFetch;
  URL.createObjectURL = origCreateObjectURL;
  document.documentElement.style.fontSize = origRootFontSize;
  localStorage.clear();
  vi.restoreAllMocks();
});

const emptyModels = () =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

const blurAndKey = (key: string, opts: any = {}) => {
  (document.activeElement as HTMLElement | null)?.blur?.();
  fireEvent.keyDown(window, { key, ...opts });
};

// ── #342 Font zoom ───────────────────────────────────────────────────────────

describe('Font zoom (#342)', () => {
  it('Ctrl+= increases the root font size', async () => {
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument(), { timeout: 3000 });
    const before = document.documentElement.style.fontSize;
    blurAndKey('=', { ctrlKey: true });
    await waitFor(() => {
      expect(document.documentElement.style.fontSize).not.toBe(before);
    });
    expect(parseFloat(document.documentElement.style.fontSize)).toBeGreaterThan(parseFloat(before || '16') || 16);
  });

  it('Ctrl+- decreases the root font size', async () => {
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument(), { timeout: 3000 });
    blurAndKey('-', { ctrlKey: true });
    await waitFor(() => {
      expect(parseFloat(document.documentElement.style.fontSize)).toBeLessThan(16);
    });
  });

  it('Ctrl+0 resets zoom to 100%', async () => {
    global.fetch = emptyModels();
    localStorage.setItem('ollama_gui_font_scale', '1.3');
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument(), { timeout: 3000 });
    expect(parseFloat(document.documentElement.style.fontSize)).toBeCloseTo(16 * 1.3, 0);
    blurAndKey('0', { ctrlKey: true });
    await waitFor(() => {
      expect(parseFloat(document.documentElement.style.fontSize)).toBeCloseTo(16, 0);
    });
    expect(localStorage.getItem('ollama_gui_font_scale')).toBe('1');
  });

  it('persists zoom to localStorage', async () => {
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument(), { timeout: 3000 });
    blurAndKey('=', { ctrlKey: true });
    await waitFor(() => expect(localStorage.getItem('ollama_gui_font_scale')).not.toBeNull());
    const v = parseFloat(localStorage.getItem('ollama_gui_font_scale')!);
    expect(v).toBeGreaterThan(1);
  });

  it('shows zoom shortcuts in the help overlay', async () => {
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument(), { timeout: 3000 });
    blurAndKey('?', {});
    expect(await screen.findByText('Zoom In')).toBeInTheDocument();
    expect(screen.getByText('Zoom Out')).toBeInTheDocument();
    expect(screen.getByText('Reset Zoom')).toBeInTheDocument();
  });
});

// ── #343 /export html ────────────────────────────────────────────────────────

describe('/export html slash command (#343)', () => {
  it('exports the current conversation as an HTML file', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 's1', title: 'Html chat', messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi there' }], model: 'llama3', createdAt: 1000 },
    ]));
    const captured: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { captured.push(blob); return 'blob:mock'; }) as any;
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Html chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Html chat/i })[0]);
    await waitFor(() => expect(screen.getByText('Hi there')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/export html' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Exported conversation as HTML')).toBeInTheDocument();
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[captured.length - 1].type).toBe('text/html');
  });

  it('shows empty message when the conversation is empty', async () => {
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/export html' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Nothing to export — the conversation is empty')).toBeInTheDocument();
  });
});

// ── #344 /merge ──────────────────────────────────────────────────────────────

describe('/merge slash command (#344)', () => {
  it('merges another session\u2019s messages into the current one', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 'main', title: 'Main chat', messages: [{ role: 'user', content: 'Hello main' }], model: 'llama3', createdAt: 1000 },
      { id: 'other', title: 'Other chat', messages: [{ role: 'user', content: 'Extra one' }, { role: 'assistant', content: 'Extra two' }], model: 'llama3', createdAt: 2000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Main chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Main chat/i })[0]);
    await waitFor(() => expect(screen.getByText('Hello main')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/merge other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText(/Merged 2 messages/)).toBeInTheDocument();
    // The merged messages now appear in the chat
    await waitFor(() => expect(screen.getByText('Extra one')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('refuses to merge a session into itself', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 'main', title: 'Self chat', messages: [{ role: 'user', content: 'Hello' }], model: 'llama3', createdAt: 1000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Self chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Self chat/i })[0]);
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/merge main' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Cannot merge a conversation into itself')).toBeInTheDocument();
  });

  it('reports when the target session is not found', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 'main', title: 'Found chat', messages: [{ role: 'user', content: 'Hello' }], model: 'llama3', createdAt: 1000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Found chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Found chat/i })[0]);
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/merge nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Session "nope" not found')).toBeInTheDocument();
  });

  it('shows usage when no argument is given', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 'main', title: 'Usage chat', messages: [{ role: 'user', content: 'Hello' }], model: 'llama3', createdAt: 1000 },
    ]));
    global.fetch = emptyModels();
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Usage chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Usage chat/i })[0]);
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/merge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Usage: /merge <session-id>')).toBeInTheDocument();
  });
});
