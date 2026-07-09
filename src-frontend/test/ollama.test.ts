import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchOllamaModels, pullOllamaModel, deleteOllamaModel, SUGGESTED_MODELS, fetchOllamaChatStream, cleanGenerationOptions, computeGenStats } from '../services/ollama';

describe('Generation options (#110)', () => {
  let origFetch: typeof global.fetch;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; }); // don't leak our stub into other suites

  function streamBodyMock() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }) }) },
    });
    global.fetch = fetchMock as any;
    return fetchMock;
  }

  it('includes options.num_ctx in the chat body when provided', async () => {
    const fetchMock = streamBodyMock();
    await fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }], () => {}, 'http://x/api/chat', false, { num_ctx: 4096, temperature: 0.2 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.options).toEqual({ num_ctx: 4096, temperature: 0.2 });
  });

  it('omits options entirely when none are set', async () => {
    const fetchMock = streamBodyMock();
    await fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }], () => {}, 'http://x/api/chat');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.options).toBeUndefined();
  });

  it('cleanGenerationOptions strips undefined/NaN and returns undefined when empty', () => {
    expect(cleanGenerationOptions({ num_ctx: undefined, temperature: NaN })).toBeUndefined();
    expect(cleanGenerationOptions(undefined)).toBeUndefined();
    expect(cleanGenerationOptions({ num_ctx: 2048 })).toEqual({ num_ctx: 2048 });
  });
});

describe('Suggested models', () => {
  it('includes ministral-3:3b recommended for 8GB RAM', () => {
    const m = SUGGESTED_MODELS.find(s => s.name === 'ministral-3:3b');
    expect(m).toBeDefined();
    expect(m?.recommended).toBe(true);
    expect(m?.minRamGB).toBe(8);
  });

  it('has exactly one recommended model', () => {
    expect(SUGGESTED_MODELS.filter(s => s.recommended)).toHaveLength(1);
  });

  it('every entry has a name, positive size and RAM requirement', () => {
    for (const s of SUGGESTED_MODELS) {
      expect(s.name).toMatch(/.+/);
      expect(s.sizeGB).toBeGreaterThan(0);
      expect(s.minRamGB).toBeGreaterThan(0);
    }
  });

  it('has no duplicate model names', () => {
    const names = SUGGESTED_MODELS.map(s => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('Ollama Service', () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  it('fetchOllamaModels should return a list of models with cloud property', async () => {
    const mockModels = [{ name: 'llama3' }, { name: 'mistral' }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: mockModels }),
    });

    const models = await fetchOllamaModels();
    expect(models).toEqual([
      { name: 'llama3', cloud: false },
      { name: 'mistral', cloud: false },
    ]);
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.any(Object));
  });

  it('pullOllamaModel should handle progress and completion', async () => {
    const mockBody = {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(JSON.stringify({ status: 'downloading' }) + '\n') })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }),
    };
    mockFetch.mockResolvedValue({
      ok: true,
      body: mockBody,
    });

    const progressUpdates: string[] = [];
    await pullOllamaModel('test-model', (progress) => {
      progressUpdates.push(progress.status ?? 'unknown');
    });

    expect(progressUpdates).toContain('downloading');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/pull', expect.any(Object));
  });

  it('deleteOllamaModel should call the DELETE endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
    });

    await deleteOllamaModel('test-model');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/delete', expect.objectContaining({
      method: 'DELETE'
    }));
  });
});

describe('Reasoning/thinking pass-through (#241)', () => {
  let origFetch: typeof global.fetch;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  function streamWithLines(lines: string[]) {
    const enc = new TextEncoder();
    const chunks = lines.map(l => enc.encode(l));
    let i = 0;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined } }) },
    });
    global.fetch = fetchMock as any;
    return fetchMock;
  }

  it('passes message.thinking chunks through to onChunk', async () => {
    streamWithLines(['{"message":{"thinking":"step 1"}}\n', '{"message":{"content":"answer"}}\n']);
    const chunks: any[] = [];
    await fetchOllamaChatStream('r1', [{ role: 'user', content: 'hi' }], (c) => chunks.push(c), 'http://x/api/chat');
    expect(chunks.some(c => c.message?.thinking === 'step 1')).toBe(true);
    expect(chunks.some(c => c.message?.content === 'answer')).toBe(true);
  });

  it('passes top-level thinking chunks through to onChunk', async () => {
    streamWithLines(['{"thinking":"top-level reasoning","response":"","done":false}\n']);
    const chunks: any[] = [];
    await fetchOllamaChatStream('r1', [{ role: 'user', content: 'hi' }], (c) => chunks.push(c), 'http://x/api/chat');
    expect(chunks.some(c => c.thinking === 'top-level reasoning')).toBe(true);
  });
});

describe('Ollama API error-handling, abort & timeout (#224)', () => {
  let origFetch: typeof global.fetch;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  function readerWithChunks(chunks: Uint8Array[]) {
    let i = 0;
    return { read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined } };
  }

  it('fetchOllamaChatStream throws Ollama API error on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, statusText: 'Internal Server Error' }) as any;
    await expect(
      fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }], () => {}, 'http://x/api/chat'),
    ).rejects.toThrow(/Ollama API error: Internal Server Error/);
  });

  it('fetchOllamaChatStream throws when the response body is null', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: null }) as any;
    await expect(
      fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }], () => {}, 'http://x/api/chat'),
    ).rejects.toThrow('Response body is null');
  });

  it('fetchOllamaModels throws Ollama API error on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, statusText: 'Not Found' }) as any;
    await expect(fetchOllamaModels('http://x')).rejects.toThrow(/Ollama API error: Not Found/);
  });

  it('a malformed stream line is skipped, not thrown', async () => {
    const enc = new TextEncoder();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => readerWithChunks([enc.encode('not-json\n{"message":{"content":"ok"}}\n')]) },
    }) as any;
    const chunks: any[] = [];
    await fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }], (c) => chunks.push(c), 'http://x/api/chat');
    expect(chunks.some(c => c.message?.content === 'ok')).toBe(true);
  });

  it('propagates an abort signal: an already-aborted signal rejects the fetch', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: any) => {
      if (init?.signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
      return Promise.resolve({ ok: true, body: { getReader: () => readerWithChunks([]) } });
    });
    global.fetch = fetchMock as any;
    const ac = new AbortController();
    ac.abort();
    await expect(
      fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }], () => {}, 'http://x/api/chat', false, undefined, ac.signal),
    ).rejects.toThrow('aborted');
  });

  it('timeoutMs aborts a hanging stream', async () => {
    // A reader that never resolves until the combined signal aborts.
    const fetchMock = vi.fn().mockImplementation((_url: string, init: any) => {
      return Promise.resolve({
        ok: true,
        body: {
          getReader: () => ({
            read: () => new Promise<void>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            }),
          }),
        },
      });
    });
    global.fetch = fetchMock as any;
    // Real timers with a short timeout: by the time it fires, the stream is
    // already awaiting reader.read(), so the abort rejection is handled.
    await expect(
      fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }], () => {}, 'http://x/api/chat', false, undefined, undefined, undefined, 30),
    ).rejects.toThrow('aborted');
  });

  it('timeoutMs is cleared on a successful completion (no dangling timer)', async () => {
    const enc = new TextEncoder();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => readerWithChunks([enc.encode('{"message":{"content":"done"}}\n')]) },
    }) as any;
    const chunks: any[] = [];
    await fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }], (c) => chunks.push(c), 'http://x/api/chat', false, undefined, undefined, undefined, 1000);
    expect(chunks.some(c => c.message?.content === 'done')).toBe(true);
  });
});


// ── computeGenStats (#297) ────────────────────────────────────────────────────

describe('computeGenStats (#297)', () => {
  it('computes tokens/sec from eval_count and eval_duration (nanoseconds)', () => {
    const stats = computeGenStats({ eval_count: 100, eval_duration: 1_000_000_000 });
    expect(stats?.tokensPerSec).toBeCloseTo(100, 1);
    expect(stats?.evalCount).toBe(100);
  });

  it('computes total duration in ms from nanoseconds', () => {
    const stats = computeGenStats({ eval_count: 50, total_duration: 2_000_000_000 });
    expect(stats?.totalDurationMs).toBe(2000);
  });

  it('returns undefined when eval_count is missing or zero', () => {
    expect(computeGenStats({})).toBeUndefined();
    expect(computeGenStats({ eval_count: 0 })).toBeUndefined();
  });
});
