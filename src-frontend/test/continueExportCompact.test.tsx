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

  it('routes /compact summarize to a connection\'s own endpoint with the bare model name (#590)', async () => {
    // An OpenAI-compatible (LM Studio / vLLM) connection. Compaction must NOT
    // POST the summary to local Ollama, and must send the bare model name
    // (not the "conn-openai/qwen" selector id).
    localStorage.setItem('model_connections', JSON.stringify([
      { id: 'conn-openai', name: 'LM Studio', kind: 'openai', baseUrl: 'http://lm:1234', apiKey: 'secret-key', enabled: true },
    ]));

    const chatCalls: { url: string; body: any; headers?: Record<string, string> }[] = [];
    let localChatCalled = false;

    function streamReply(content: string) {
      const reader = { read: vi.fn() as ReturnType<typeof vi.fn> };
      reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from(`data: {"choices":[{"delta":{"content":"${content}"}}]}\n`) });
      reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('data: {"choices":[{"delta":{}}]}\n') });
      reader.read.mockResolvedValueOnce({ done: true, value: undefined });
      return Promise.resolve({ ok: true, body: { getReader: () => reader } });
    }

    global.fetch = vi.fn(async (url: unknown, opts: any) => {
      const u = String(url);
      const init = (opts ?? {}) as { headers?: Record<string, string>; body?: string };
      const body = init.body ? JSON.parse(init.body) : {};
      if (u.includes('/v1/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'qwen' }] }) } as any;
      }
      if (u.includes('/api/tags')) {
        return { ok: true, json: async () => ({ models: [{ name: 'llama3' }] }) } as any;
      }
      if (u.includes('/v1/chat/completions')) {
        chatCalls.push({ url: u, body, headers: init.headers as Record<string, string> });
        return streamReply('A concise reply.');
      }
      if (u.includes('/api/chat')) {
        localChatCalled = true;
        return streamReply('Local reply.');
      }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' };
    });

    render(<App />);

    // The connection model must appear in the selector.
    const sel = screen.getByLabelText('Select AI model') as HTMLSelectElement;
    await waitFor(() => {
      const values = screen.getAllByRole('option').map(o => o.getAttribute('value'));
      expect(values).toContain('conn-openai/qwen');
    }, { timeout: 5000 });
    // Select it.
    fireEvent.change(sel, { target: { value: 'conn-openai/qwen' } });
    await waitFor(() => expect(sel.value).toBe('conn-openai/qwen'), { timeout: 5000 });

    // Send a message so the conversation is large enough to compact.
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'hi cats' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(document.body.textContent).toContain('A concise reply.'), { timeout: 5000 });

    // Run /compact.
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/compact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByText(/Compacted/)).toBeInTheDocument(), { timeout: 5000 });

    // The summarize POST went to the connection's /v1/chat/completions, not local /api/chat.
    expect(localChatCalled).toBe(false);
    // Two calls: 1) chat reply, 2) /compact summarize. Both use /v1/chat/completions on the connection.
    expect(chatCalls.length).toBeGreaterThanOrEqual(2);
    const compactCall = chatCalls[chatCalls.length - 1];
    expect(compactCall.url).toContain('http://lm:1234/v1/chat/completions');
    // Bare model name, not the connection-scoped selector id.
    expect(compactCall.body.model).toBe('qwen');
    expect(compactCall.body.model).not.toBe('conn-openai/qwen');
    // Auth is forwarded to the connection.
    expect(compactCall.headers?.Authorization).toBe('Bearer secret-key');
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
