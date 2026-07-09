/**
 * Pin shortcut (#321), recent models (#322), and /export json (#323).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Pin keyboard shortcut (#321)', () => {
  it('pins the current conversation with Ctrl+Shift+P', async () => {
    const sessions = [
      { id: 's1', title: 'Test chat', messages: [{ role: 'user', content: 'Hi' }], model: 'llama3', createdAt: Date.now() },
    ];
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Test chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Test chat/i })[0]);
    await waitFor(() => expect(screen.getByText('Hi')).toBeInTheDocument(), { timeout: 2000 });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: 'P', shiftKey: true, ctrlKey: true });
    expect(await screen.findByText('Pinned conversation')).toBeInTheDocument();
  });
});

describe('Recent models tracking (#322)', () => {
  it('tracks the used model in localStorage after sending a message', async () => {
    const reader = { read: vi.fn() as ReturnType<typeof vi.fn> };
    reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"Hello"}}\n') });
    reader.read.mockResolvedValueOnce({ done: true, value: undefined });
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat')) {
        return Promise.resolve({ ok: true, body: { getReader: () => reader } });
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(document.body.textContent).toContain('Hello'), { timeout: 3000 });
    await waitFor(() => {
      const recent = JSON.parse(localStorage.getItem('ollama_gui_recent_models') ?? '[]');
      expect(recent).toContain('llama3');
    }, { timeout: 2000 });
  });
});

describe('/export json slash command (#323)', () => {
  it('shows empty message when no messages exist', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/export json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Nothing to export — the conversation is empty')).toBeInTheDocument();
  });

  it('exports current conversation as JSON', async () => {
    const sessions = [
      { id: 's1', title: 'Test chat', messages: [{ role: 'user', content: 'Hi' }], model: 'llama3', createdAt: Date.now() },
    ];
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
    const createObjURL = vi.fn(() => 'blob:mock');
    const revokeObjURL = vi.fn();
    URL.createObjectURL = createObjURL;
    URL.revokeObjectURL = revokeObjURL;
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Test chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Test chat/i })[0]);
    await waitFor(() => expect(screen.getByText('Hi')).toBeInTheDocument(), { timeout: 2000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/export json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Exported conversation as JSON')).toBeInTheDocument();
    expect(createObjURL).toHaveBeenCalled();
  });
});
