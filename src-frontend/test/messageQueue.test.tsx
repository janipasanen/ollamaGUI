import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

const chunk = (s: string) => ({ done: false, value: Buffer.from(`{"message":{"content":"${s}"}}\n`) });
const DONE = { done: true, value: undefined };

describe('Message queue (#137)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('enqueues while streaming and auto-sends FIFO on completion', async () => {
    const firstDone = deferred<any>();
    let chatCall = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (!String(url).includes('/api/chat')) {
        return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null });
      }
      chatCall++;
      if (chatCall === 1) {
        let step = 0;
        return Promise.resolve({ ok: true, body: { getReader: () => ({ read: () => { step++; return step === 1 ? Promise.resolve(chunk('first')) : firstDone.promise; } }) } });
      }
      let step = 0;
      return Promise.resolve({ ok: true, body: { getReader: () => ({ read: () => { step++; return Promise.resolve(step === 1 ? chunk('second') : DONE); } }) } });
    }) as any;

    render(<App />);
    const input = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(input, { target: { value: 'q1' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());

    // Enqueue while the first reply is still streaming.
    fireEvent.change(input, { target: { value: 'q2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('queued')).toBeInTheDocument();

    // Finish the first turn → the queued message auto-sends.
    await act(async () => { firstDone.resolve(DONE); });
    await waitFor(() => expect(screen.getByText('second')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('queued')).not.toBeInTheDocument());
    expect(chatCall).toBe(2);
  });

  it('removes a queued item before it sends', async () => {
    const firstDone = deferred<any>();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (!String(url).includes('/api/chat')) return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null });
      let step = 0;
      return Promise.resolve({ ok: true, body: { getReader: () => ({ read: () => { step++; return step === 1 ? Promise.resolve(chunk('first')) : firstDone.promise; } }) } });
    }) as any;

    render(<App />);
    const input = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(input, { target: { value: 'q1' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());

    fireEvent.change(input, { target: { value: 'q2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('queued')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Remove queued message'));
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
    await act(async () => { firstDone.resolve(DONE); });
  });

  it('cancelling the active turn halts the queue (no auto-send)', async () => {
    let chatCall = 0;
    global.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (!String(url).includes('/api/chat')) return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null });
      chatCall++;
      const signal: AbortSignal | undefined = init?.signal;
      let step = 0;
      return Promise.resolve({
        ok: true,
        body: {
          getReader: () => ({
            read: () => {
              step++;
              if (step === 1) return Promise.resolve(chunk('first'));
              // hang until the request is aborted, then reject like fetch does
              return new Promise((_, reject) => {
                signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
              });
            },
          }),
        },
      });
    }) as any;

    render(<App />);
    const input = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(input, { target: { value: 'q1' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());

    fireEvent.change(input, { target: { value: 'q2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('queued')).toBeInTheDocument();

    // Cancel the active turn → queue must NOT auto-drain.
    await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
    await waitFor(() => expect(screen.getByText('queued')).toBeInTheDocument());
    expect(chatCall).toBe(1); // no second turn was started
  });
});
