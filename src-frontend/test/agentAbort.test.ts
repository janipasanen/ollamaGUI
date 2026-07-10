/**
 * Clean abort handling in the agentic loop (#405): a user-initiated Stop
 * (AbortSignal) during a fetch must NOT surface an "Error: aborted" banner.
 * Instead `onCancel` fires and the loop breaks silently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolRegistry } from '../services/tools';
import { agenticChatStream } from '../services/agent';

function streamResponse(text: string) {
  return {
    ok: true,
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => {
            if (!sent) { sent = true; return { done: false, value: new TextEncoder().encode(text) }; }
            return { done: true, value: undefined };
          },
        };
      },
    },
  };
}

const finalLine = (content: string) => JSON.stringify({ message: { role: 'assistant', content }, done: true });

beforeEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
});
afterEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
});

describe('Agentic abort handling (#405)', () => {
  it('a mid-fetch abort fires onCancel, not onError, and yields no error message', async () => {
    let errored = 0;
    let cancelled = 0;
    const yielded: string[] = [];

    // Signal is NOT aborted up front — the fetch rejects with AbortError
    // mid-stream, so the loop reaches the outer catch (not the top-of-iteration
    // guard) and must classify it as a cancel.
    const ac = new AbortController();
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.reject(new DOMException('aborted', 'AbortError')),
    ) as never;

    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 5,
      endpoint: 'http://x/api/chat', signal: ac.signal,
      onError: () => { errored++; },
      onCancel: () => { cancelled++; },
    });
    for await (const m of gen) { yielded.push(m.content); }

    expect(errored).toBe(0);
    expect(cancelled).toBe(1);
    expect(yielded.some(c => c.startsWith('Error:'))).toBe(false);
  });

  it('an already-aborted signal breaks the loop before any fetch (onCancel not fired, no error)', async () => {
    let fetchCalls = 0;
    let errored = 0;
    let cancelled = 0;
    global.fetch = vi.fn().mockImplementation(() => { fetchCalls++; return Promise.resolve(streamResponse(finalLine('x'))); }) as never;

    const ac = new AbortController();
    ac.abort();
    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 5,
      endpoint: 'http://x/api/chat', signal: ac.signal,
      onError: () => { errored++; },
      onCancel: () => { cancelled++; },
    });
    for await (const _ of gen) { void _; }

    // The top-of-iteration guard breaks immediately — no fetch, no cancel, no error.
    expect(fetchCalls).toBe(0);
    expect(errored).toBe(0);
    expect(cancelled).toBe(0);
  });

  it('a non-abort fetch error still fires onError with an error message', async () => {
    let errored = 0;
    let cancelled = 0;
    const yielded: string[] = [];
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as never;

    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 5,
      endpoint: 'http://x/api/chat',
      onError: () => { errored++; },
      onCancel: () => { cancelled++; },
    });
    for await (const m of gen) { yielded.push(m.content); }

    expect(errored).toBe(1);
    expect(cancelled).toBe(0);
    expect(yielded.some(c => c.includes('network down'))).toBe(true);
  });
});
