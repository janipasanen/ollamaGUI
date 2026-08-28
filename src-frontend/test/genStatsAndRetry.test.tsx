/**
 * Generation speed indicator (#297) and retry button on errors (#299).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
});

describe('Generation speed indicator (#297)', () => {
  it('displays tokens/sec when the final chunk includes eval stats', async () => {
    global.fetch = modelsThenStream([
      '{"message":{"content":"Hello there"}}\n',
      '{"done":true,"eval_count":100,"eval_duration":1000000000,"total_duration":1200000000}\n',
    ]);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(document.body.textContent).toContain('Hello there'), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText(/tok\/s/)).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('100 tokens')).toBeInTheDocument();
  });
});

describe('Retry button on failed messages (#299)', () => {
  it('shows a Retry button after a generation error', async () => {
    let call = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null });
      return Promise.resolve({ ok: false, statusText: 'Service Unavailable', body: null });
    });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry failed message' })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

    it('retries the failed message by re-sending the last prompt', async () => {
      // Key off the number of *chat* calls so background model-list probes
      // (config.json, /api/show, /api/tags, gx10 remote, /api/ps) can't shift
      // which attempt fails — the first chat call fails, the retry succeeds.
      let chatCalls = 0;
      global.fetch = vi.fn().mockImplementation((url: unknown) => {
        const u = String(url);
        const isChat = u.includes('/api/chat') || u.includes('generate');
        if (!isChat) return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
        chatCalls++;
        if (chatCalls === 1) return Promise.resolve({ ok: false, statusText: 'Service Unavailable', body: null });
        const reader = { read: vi.fn() as ReturnType<typeof vi.fn> };
        reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"Hello there"}}\n') });
        reader.read.mockResolvedValueOnce({ done: true, value: undefined });
        return Promise.resolve({ ok: true, body: { getReader: () => reader } });
      });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByText('Send'));
    const retryBtn = await waitFor(() => screen.getByRole('button', { name: 'Retry failed message' }), { timeout: 3000 });
    fireEvent.click(retryBtn);
    await waitFor(() => expect(document.body.textContent).toContain('Hello there'), { timeout: 3000 });
    });
});


// ── stop reason + prompt token count (#391, #392) ──────────────────────────────

describe('Stop reason + prompt tokens (#391, #392)', () => {
  it('renders the stop reason and prompt→completion tokens', async () => {
    global.fetch = modelsThenStream([
      '{"message":{"content":"Partial answer"}}\n',
      '{"done":true,"eval_count":40,"eval_duration":500000000,"prompt_eval_count":210,"done_reason":"length"}\n',
    ]);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(document.body.textContent).toContain('Partial answer'), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText(/length-limited/)).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('210→40 tokens')).toBeInTheDocument();
  });

  it('renders the stop reason for a normal stop', async () => {
    global.fetch = modelsThenStream([
      '{"message":{"content":"All done"}}\n',
      '{"done":true,"eval_count":5,"eval_duration":50000000,"done_reason":"stop"}\n',
    ]);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(document.body.textContent).toContain('All done'), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText(/stopped/)).toBeInTheDocument(), { timeout: 3000 });
  });
});
