/**
 * Message queue (#137): submissions while a reply is streaming are enqueued
 * (shown as "queued" chips) and auto-sent FIFO when the active turn completes.
 */
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

describe('Message queue (#137)', () => {
  it('enqueues a submission while streaming and auto-sends it when the turn completes', async () => {
    let releaseFirst: () => void = () => {};
    let chatCalls = 0;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        chatCalls++;
        if (chatCalls === 1) {
          // First turn: emit a chunk, then hang until released.
          const done = new Promise<void>(r => { releaseFirst = r; });
          const reader = {
            read: vi.fn().mockImplementation(async () => {
              return { done: false, value: Buffer.from('{"message":{"content":"first reply"}}\n') };
            }),
          };
          reader.read.mockImplementationOnce(async () => {
            return { done: false, value: Buffer.from('{"message":{"content":"first reply"}}\n') };
          });
          reader.read.mockImplementationOnce(async () => {
            await done;
            return { done: true, value: undefined };
          });
          return Promise.resolve({ ok: true, body: { getReader: () => reader } });
        }
        // Second (queued) turn: resolve immediately with a final answer.
        const reader = { read: vi.fn() };
        reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"second reply"},"done":true}\n') });
        reader.read.mockResolvedValueOnce({ done: true, value: undefined });
        return Promise.resolve({ ok: true, body: { getReader: () => reader } });
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // Wait until the first turn is streaming.
    await waitFor(() => expect(screen.getByText(/first reply/i)).toBeInTheDocument(), { timeout: 5000 });

    // Submit a second message while still streaming (Enter in the composer,
    // since the send button is now "Cancel generation") -> enqueued.
    const composer = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(composer, { target: { value: 'second' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('queued')).toBeInTheDocument();
      expect(screen.getByText('second')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Release the first turn; the queued message auto-sends.
    releaseFirst();
    await waitFor(() => expect(screen.getByText(/second reply/i)).toBeInTheDocument(), { timeout: 8000 });

    // The queued chip is gone once it has been sent.
    await waitFor(() => expect(screen.queryByText('queued')).not.toBeInTheDocument(), { timeout: 5000 });

    // Regression: the queued message must be sent exactly once. A re-entrant
    // auto-send effect would re-fire on `isLoading` ticks and call the
    // Ollama stream mock repeatedly.
    expect(chatCalls).toBe(2);
  }, 30000);

  it('a queued message can be removed before it is sent', async () => {
    let releaseFirst: () => void = () => {};
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        chatCalls++;
        const reader = { read: vi.fn() };
        reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"first reply"}}\n') });
        reader.read.mockImplementationOnce(async () => {
          await new Promise<void>(r => { releaseFirst = r; });
          return { done: true, value: undefined };
        });
        return Promise.resolve({ ok: true, body: { getReader: () => reader } });
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByText(/first reply/i)).toBeInTheDocument(), { timeout: 5000 });

    const composer = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(composer, { target: { value: 'second' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove queued message' })).toBeInTheDocument(), { timeout: 5000 });

    fireEvent.click(screen.getByRole('button', { name: 'Remove queued message' }));
    await waitFor(() => expect(screen.queryByText('queued')).not.toBeInTheDocument(), { timeout: 5000 });

    // Releasing the first turn must NOT auto-send the removed message.
    const callsBefore = chatCalls;
    releaseFirst();
    await new Promise(r => setTimeout(r, 500));
    expect(chatCalls).toBe(callsBefore);
  }, 30000);
});
