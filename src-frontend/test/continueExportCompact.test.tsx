/**
 * Continue generation (#303), per-message export (#304), and /compact (#305).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

function modelsThenStream(chunks: string[]) {
  return vi.fn().mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes('/api/chat') || u.includes('generate')) {
      const reader = { read: vi.fn() as ReturnType<typeof vi.fn> };
      chunks.forEach(c => reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from(c) }));
      reader.read.mockResolvedValueOnce({ done: true, value: undefined });
      return Promise.resolve({ ok: true, body: { getReader: () => reader } });
    }
    return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
  });
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
});

afterEach(() => {
  localStorage.clear();
});

describe('Continue generation button (#303)', () => {
  it('shows a Continue button on a cancelled reply', async () => {
    // Seed a session with a cancelled assistant message
    const sessions = [
      { id: 's1', title: 'Test', messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Partial reply\n\n*(generation cancelled)*', wasCancelled: true },
      ], model: 'llama3', createdAt: Date.now() },
    ];
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
    render(<App />);
    // Wait for and click the session
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Test/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Test/i })[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue generation' })).toBeInTheDocument(), { timeout: 3000 });
  });
});

describe('Per-message export button (#304)', () => {
  it('shows a Download button on each assistant message', async () => {
    global.fetch = modelsThenStream(['{"message":{"content":"Hello there"}}\n']);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(document.body.textContent).toContain('Hello there'), { timeout: 3000 });
    expect(screen.getByRole('button', { name: 'Download message as Markdown' })).toBeInTheDocument();
  });
});

describe('/compact slash command (#305)', () => {
  it('rejects compaction when there are not enough messages', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/compact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Not enough messages to compact')).toBeInTheDocument();
  });

  it('compacts a conversation into a summary', async () => {
    // First call returns the original reply, second call (compact) returns the summary
    let chatCall = 0;
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat')) {
        chatCall++;
        const reader = { read: vi.fn() as ReturnType<typeof vi.fn> };
        if (chatCall === 1) {
          reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"Cats are great pets."}}\n') });
        } else {
          reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"Summary: The user asked about cats."}}\n') });
        }
        reader.read.mockResolvedValueOnce({ done: true, value: undefined });
        return Promise.resolve({ ok: true, body: { getReader: () => reader } });
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });
    render(<App />);
    // Send a message to create a conversation
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Tell me about cats' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(document.body.textContent).toContain('Cats are great pets.'), { timeout: 3000 });
    // Now run /compact
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/compact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByText(/Compacted/)).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText(/Previous conversation summary/)).toBeInTheDocument();
  });
});

describe('Continue generation — click resumes (#303)', () => {
  it('clicking Continue appends streamed content and clears the cancelled note', async () => {
    // Seed a session with a cancelled assistant message.
    const sessions = [
      { id: 's1', title: 'Test', messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Partial reply\n\n*(generation cancelled)*', wasCancelled: true },
      ], model: 'llama3', createdAt: Date.now() },
    ];
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));

    // The continue call streams an appended chunk then a done frame.
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        const reader = { read: vi.fn() };
        reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":" continued"}}\n') });
        reader.read.mockResolvedValueOnce({ done: true, value: undefined });
        return Promise.resolve({ ok: true, body: { getReader: () => reader } });
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Test/i })[0]);
    const continueBtn = await screen.findByRole('button', { name: 'Continue generation' }, { timeout: 3000 });
    fireEvent.click(continueBtn);

    // The streamed continuation is appended to the existing reply…
    await waitFor(() => expect(document.body.textContent).toContain('Partial reply continued'), { timeout: 5000 });
    // …and the cancellation note is gone.
    await waitFor(() => expect(document.body.textContent).not.toContain('(generation cancelled)'), { timeout: 5000 });
  }, 30000);
});
