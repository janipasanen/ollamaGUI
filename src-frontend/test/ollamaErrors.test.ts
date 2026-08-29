import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchOllamaChatStream, ollamaErrorFromResponse } from '../services/ollama';
import type { Message } from '../services/ollama';

// ── Ollama API error handling + timeout (AGENTS.md QA: every Ollama API call
//    must have error handling and timeout tests) ──────────────────────────────
//
// These target the request/stream layer directly (`fetchOllamaChatStream`) and
// the `ollamaErrorFromResponse` helper, using the same `global.fetch` mock
// shape as `ollama.test.ts` — an object with `ok`, `statusText`, optional
// `json()`, and `body.getReader()` yielding `{ done, value }` SSE chunks.

describe('ollamaErrorFromResponse', () => {
  it('uses statusText when the body is not JSON', async () => {
    const res = { statusText: 'Service Unavailable', json: async () => { throw new Error('no json') } } as any;
    const err = await ollamaErrorFromResponse(res, 'Ollama API error');
    expect(err.message).toBe('Ollama API error: Service Unavailable');
  });

  it('uses body.error when present and non-empty', async () => {
    const res = { statusText: 'Internal Server Error', json: async () => ({ error: 'model not found' }) } as any;
    const err = await ollamaErrorFromResponse(res, 'Ollama API error');
    expect(err.message).toBe('Ollama API error: model not found');
  });

  it('falls back to statusText when body.error is empty', async () => {
    const res = { statusText: 'Bad Gateway', json: async () => ({ error: '   ' }) } as any;
    const err = await ollamaErrorFromResponse(res, 'Ollama API error');
    expect(err.message).toBe('Ollama API error: Bad Gateway');
  });
});

describe('fetchOllamaChatStream — non-ok HTTP responses', () => {
  it('rejects with an Ollama API error on a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({ error: 'daemon busy' }) }) as any;
    await expect(fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }] as Message[], () => {}))
      .rejects.toThrow('Ollama API error: daemon busy');
  });

  it('does not swallow the rejection (caller gets the error)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, statusText: 'Service Unavailable' }) as any;
    global.fetch = fetchMock;
    let caught: unknown;
    try {
      await fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }] as Message[], () => {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/Ollama API error/);
  });
});

describe('fetchOllamaChatStream — network / fetch errors', () => {
  it('propagates a thrown fetch (connection refused) to the caller', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed')) as any;
    await expect(fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }] as Message[], () => {}))
      .rejects.toThrow('fetch failed');
  });

  it('propagates an AbortError from a timeout as a thrown error', async () => {
    // Simulate an aborted fetch (timeout path #224).
    global.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')) as any;
    await expect(fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }] as Message[], () => {}))
      .rejects.toThrow(/abort/i);
  });
});

describe('fetchOllamaChatStream — stream chunk parsing', () => {
  it('parses a normal stream of chunks via onChunk', async () => {
    const chunks = [
      '{"message":{"content":"Par"}}\n',
      '{"message":{"content":"tial"}}\n',
      '{"done":true,"eval_count":40,"prompt_eval_count":210,"done_reason":"stop"}\n',
    ];
    const reader = { read: vi.fn() };
    chunks.forEach(c => reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from(c) }));
    reader.read.mockResolvedValueOnce({ done: true, value: undefined });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } }) as any;

    const seen: any[] = [];
    await fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }] as Message[], (c) => { seen.push(c); });
    expect(seen).toHaveLength(3);
    expect(seen[0]?.message?.content).toBe('Par');
    expect(seen[2]?.done).toBe(true);
  });

  it('skips empty SSE lines without error', async () => {
    const reader = { read: vi.fn() };
    reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('\ndata: {}\n') });
    reader.read.mockResolvedValueOnce({ done: true, value: undefined });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } }) as any;

    // Ollama serves plain JSON lines (not EventSource "data:"-prefixed lines), so
    // an empty line and a non-JSON/`data:`-prefixed line are both skipped. The
    // stream resolves cleanly without throwing.
    const seen: any[] = [];
    await expect(fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }] as Message[], (c) => { seen.push(c); }))
      .resolves.toBeUndefined();
    expect(seen).toHaveLength(0);
  });

  it('does not crash on a malformed (non-JSON) chunk; logs and continues', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reader = { read: vi.fn() };
    // First a valid chunk, then garbage, then a valid stop chunk.
    reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"ok"}}\n') });
    reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('this is not json\n') });
    reader.read.mockResolvedValueOnce({ done: true, value: undefined });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } }) as any;

    const seen: any[] = [];
    await fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }] as Message[], (c) => { seen.push(c); });
    // The one parseable chunk still reaches onChunk; the malformed one is skipped.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.message?.content).toBe('ok');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('handles a truncated stream that ends without a "done" stop chunk', async () => {
    const reader = { read: vi.fn() };
    reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"partial"}}\n') });
    // done:true but no prior done chunk — caller relies on onChunk signals.
    reader.read.mockResolvedValueOnce({ done: true, value: undefined });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } }) as any;

    const seen: any[] = [];
    await expect(fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }] as Message[], (c) => { seen.push(c); }))
      .resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
  });
});

describe('fetchOllamaChatStream — timeout via AbortSignal (#224)', () => {
  it('clears the timeout timer when the stream completes', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout').mockImplementation(() => {});
    const reader = { read: vi.fn() };
    reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"x"}}\n') });
    reader.read.mockResolvedValueOnce({ done: true, value: undefined });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } }) as any;

    await fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }] as Message[], () => {}, 'http://x/api/chat', false, undefined, undefined, undefined, 5000);
    // The timeout controller abort is scheduled at 5000ms; the stream resolves
    // before that, so clearTimeout fires exactly once for the cleanup.
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

afterEach(() => { vi.restoreAllMocks(); });
