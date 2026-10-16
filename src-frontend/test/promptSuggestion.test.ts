// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  shouldRequestSuggestion,
  acceptSuggestion,
  suggestCompletion,
} from '../services/promptSuggestion';

describe('shouldRequestSuggestion (#658 gating)', () => {
  it('requests a completion for ordinary running text', () => {
    expect(shouldRequestSuggestion('Please write a function that')).toBe(true);
  });

  it('skips while the user is in slash / @ / # completions', () => {
    expect(shouldRequestSuggestion('/')).toBe(false);
    expect(shouldRequestSuggestion('/config')).toBe(false);
    expect(shouldRequestSuggestion('hello @')).toBe(false);
    expect(shouldRequestSuggestion('see #')).toBe(false);
  });

  it('skips blank or over-long input', () => {
    expect(shouldRequestSuggestion('')).toBe(false);
    expect(shouldRequestSuggestion('x')).toBe(false);
    expect(shouldRequestSuggestion('a'.repeat(501))).toBe(false);
  });

  it('trims trailing whitespace before deciding', () => {
    expect(shouldRequestSuggestion('hi  ')).toBe(true);
    expect(shouldRequestSuggestion('/  ')).toBe(false);
  });
});

describe('acceptSuggestion (#658 Tab-accept)', () => {
  it('concatenates the current prompt with the accepted ghost', () => {
    expect(acceptSuggestion('Write ', 'a helper')).toBe('Write a helper');
    expect(acceptSuggestion('', 'hello')).toBe('hello');
    expect(acceptSuggestion('a', 'bc')).toBe('abc');
  });
});

/** Build a fake streaming Response whose chunks arrive as SSE data lines. */
function sseResponse(chunks: string[], signal?: AbortSignal) {
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (signal?.aborted) {
            const err = new DOMException('Aborted', 'AbortError');
            throw err;
          }
          if (i < chunks.length) {
            const line = `data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n`;
            return { value: new TextEncoder().encode(line), done: false };
          }
          return { value: undefined, done: true };
        },
      }),
    },
  } as unknown as Response;
}

describe('suggestCompletion streaming (#658)', () => {
  it('yields the accumulated completion across deltas', async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(() => sseResponse([' hel', 'lo ', 'world'])) as unknown as typeof fetch;
    for await (const part of suggestCompletion({ url: 'http://x/v1/chat/completions', model: 'm', prompt: 'go' })) {
      calls.push(part);
    }
    expect(calls).toEqual([' hel', ' hello ', ' hello world']);
    expect(calls[calls.length - 1]).toBe(' hello world');
  });

  it('does nothing when the prompt is gated (e.g. slash command)', async () => {
    global.fetch = vi.fn(() => sseResponse(['nope'])) as unknown as typeof fetch;
    const calls: string[] = [];
    for await (const part of suggestCompletion({ url: 'http://x/v1/chat/completions', model: 'm', prompt: '/cmd' })) {
      calls.push(part);
    }
    expect(calls).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('stops yielding once the request is aborted', async () => {
    const controller = new AbortController();
    global.fetch = vi.fn((_url, init) => sseResponse(['a', 'b', 'c'], (init as { signal?: AbortSignal })?.signal)) as unknown as typeof fetch;
    const calls: string[] = [];
    // Abort as soon as the first chunk is observed.
    for await (const part of suggestCompletion({ url: 'http://x/v1/chat/completions', model: 'm', prompt: 'go', signal: controller.signal })) {
      calls.push(part);
      if (calls.length === 1) controller.abort();
    }
    expect(calls).toEqual(['a']);
  });
});
