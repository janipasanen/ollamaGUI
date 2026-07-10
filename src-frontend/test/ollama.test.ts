import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchOllamaModels, pullOllamaModel, deleteOllamaModel, createOllamaModel, SUGGESTED_MODELS, fetchOllamaChatStream, cleanGenerationOptions, computeGenStats, ollamaErrorFromResponse } from '../services/ollama';

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

  // ── #444: stream buffer must reassemble JSON lines split across chunks ──────

  it('reassembles a JSON line split across two chunks (#444)', async () => {
    const enc = new TextEncoder();
    // Split a single JSON line mid-way through the second chunk.
    const part1 = enc.encode('{"message":{"content":"hel');
    const part2 = enc.encode('lo"}}\n');
    let i = 0;
    const chunks = [part1, part2];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined } }) },
    });
    global.fetch = fetchMock as any;

    const received: any[] = [];
    await fetchOllamaChatStream('r1', [{ role: 'user', content: 'hi' }], (c) => received.push(c), 'http://x/api/chat');
    // The split line must have been reassembled into one valid chunk.
    expect(received.some(c => c.message?.content === 'hello')).toBe(true);
  });

  it('reassembles multiple JSON lines split across chunks (#444)', async () => {
    const enc = new TextEncoder();
    // Chunk 1: first complete line + start of second line
    // Chunk 2: rest of second line + third complete line
    const c1 = enc.encode('{"message":{"content":"a"}}\n{"message":{"content":"b"');
    const c2 = enc.encode('}}\n{"message":{"content":"c"}}\n');
    let i = 0;
    const chunks = [c1, c2];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined } }) },
    });
    global.fetch = fetchMock as any;

    const received: any[] = [];
    await fetchOllamaChatStream('r1', [{ role: 'user', content: 'hi' }], (c) => received.push(c), 'http://x/api/chat');
    const contents = received.map(c => c.message?.content).filter(Boolean);
    expect(contents).toContain('a');
    expect(contents).toContain('b');
    expect(contents).toContain('c');
  });

  it('handles a JSON line without trailing newline after stream ends (#444)', async () => {
    const enc = new TextEncoder();
    // No trailing newline — the flush path must handle it.
    const c1 = enc.encode('{"message":{"content":"flush"}}');
    let i = 0;
    const chunks = [c1];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined } }) },
    });
    global.fetch = fetchMock as any;

    const received: any[] = [];
    await fetchOllamaChatStream('r1', [{ role: 'user', content: 'hi' }], (c) => received.push(c), 'http://x/api/chat');
    expect(received.some(c => c.message?.content === 'flush')).toBe(true);
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

// ── stop reason + prompt token count (#391, #392) ─────────────────────────────

describe('computeGenStats stop reason + prompt tokens (#391, #392)', () => {
  it('captures done_reason as a human-readable stopReason', () => {
    const stats = computeGenStats({ eval_count: 12, eval_duration: 100_000_000, done_reason: 'length' });
    expect(stats?.stopReason).toBe('length-limited');
    expect(stats?.evalCount).toBe(12);
  });

  it('maps stop / tool_calls / load reasons', () => {
    expect(computeGenStats({ eval_count: 1, done_reason: 'stop' })?.stopReason).toBe('stopped');
    expect(computeGenStats({ eval_count: 1, done_reason: 'tool_calls' })?.stopReason).toBe('tool call');
    // load-only turns into no stop reason
    expect(computeGenStats({ eval_count: 1, done_reason: 'load' })?.stopReason).toBeUndefined();
  });

  it('captures prompt_eval_count as promptCount', () => {
    const stats = computeGenStats({ eval_count: 30, prompt_eval_count: 128, done_reason: 'stop' });
    expect(stats?.promptCount).toBe(128);
    expect(stats?.evalCount).toBe(30);
  });

  it('returns stats for a pure tool_calls turn with zero completion tokens', () => {
    const stats = computeGenStats({ eval_count: 0, prompt_eval_count: 50, done_reason: 'tool_calls' });
    expect(stats?.stopReason).toBe('tool call');
    expect(stats?.promptCount).toBe(50);
    expect(stats?.evalCount).toBeUndefined();
  });

  it('returns undefined when there is nothing to report', () => {
    expect(computeGenStats({ done_reason: 'load' })).toBeUndefined();
    expect(computeGenStats({ eval_count: 0, prompt_eval_count: 0 })).toBeUndefined();
  });
});


// ── #455: createOllamaModel must not crash on malformed JSON lines ────────────

describe('createOllamaModel error handling (#455)', () => {
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

  it('skips malformed JSON lines without crashing (#455)', async () => {
    streamWithLines([
      '{"status":"creating model"}\n',
      'not valid json\n',
      '{"status":"done"}\n',
    ]);
    const progress: any[] = [];
    await createOllamaModel('mymodel', 'FROM llama3', (p) => progress.push(p), 'http://x/api/create');
    // The valid chunks should be parsed; the malformed line skipped
    expect(progress.some(p => p.status === 'creating model')).toBe(true);
    expect(progress.some(p => p.status === 'done')).toBe(true);
  });

  it('re-throws chunk.error from the stream (#455)', async () => {
    streamWithLines([
      '{"status":"starting"}\n',
      '{"error":"model not found"}\n',
    ]);
    const progress: any[] = [];
    await expect(
      createOllamaModel('mymodel', 'FROM llama3', (p) => progress.push(p), 'http://x/api/create')
    ).rejects.toThrow('model not found');
  });

  it('skips malformed JSON in the flush buffer (#455)', async () => {
    // Stream ends with a partial/malformed line (no trailing newline)
    streamWithLines([
      '{"status":"starting"}\n',
      'not valid json without newline',
    ]);
    const progress: any[] = [];
    await createOllamaModel('mymodel', 'FROM llama3', (p) => progress.push(p), 'http://x/api/create');
    // Valid chunk parsed; malformed flush buffer silently skipped
    expect(progress.some(p => p.status === 'starting')).toBe(true);
  });
});

// ── #456: surface Ollama response body error on non-ok responses ─────────────

describe('ollamaErrorFromResponse and body-error surfacing (#456)', () => {
  let origFetch: typeof global.fetch;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  it('ollamaErrorFromResponse extracts .error from JSON body', async () => {
    const res = { statusText: 'Not Found', json: async () => ({ error: "model 'xyz' not found, try pulling it first" }) } as any;
    const err = await ollamaErrorFromResponse(res, 'Ollama API error');
    expect(err.message).toBe("Ollama API error: model 'xyz' not found, try pulling it first");
  });

  it('ollamaErrorFromResponse falls back to statusText when body has no .error', async () => {
    const res = { statusText: 'Bad Request', json: async () => ({ models: [] }) } as any;
    const err = await ollamaErrorFromResponse(res, 'Ollama API error');
    expect(err.message).toBe('Ollama API error: Bad Request');
  });

  it('ollamaErrorFromResponse falls back to statusText when json() throws', async () => {
    const res = { statusText: 'Internal Server Error', json: async () => { throw new SyntaxError('Unexpected token'); } } as any;
    const err = await ollamaErrorFromResponse(res, 'Ollama API error');
    expect(err.message).toBe('Ollama API error: Internal Server Error');
  });

  it('ollamaErrorFromResponse ignores empty .error string', async () => {
    const res = { statusText: 'Forbidden', json: async () => ({ error: '  ' }) } as any;
    const err = await ollamaErrorFromResponse(res, 'Ollama API error');
    expect(err.message).toBe('Ollama API error: Forbidden');
  });

  it('fetchOllamaChatStream surfaces body error on non-ok (#456)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({ error: "model 'llama3' not found, try pulling it first" }),
    }) as any;
    await expect(
      fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }], () => {}, 'http://x/api/chat'),
    ).rejects.toThrow(/model 'llama3' not found, try pulling it first/);
  });

  it('fetchOllamaModels surfaces body error on non-ok (#456)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({ error: 'registry connection refused' }),
    }) as any;
    await expect(fetchOllamaModels('http://x')).rejects.toThrow(/registry connection refused/);
  });

  it('createOllamaModel surfaces body error on non-ok (#456)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ error: 'invalid modelfile' }),
    }) as any;
    await expect(
      createOllamaModel('bad', 'FROM x', () => {}, 'http://x/api/create'),
    ).rejects.toThrow(/invalid modelfile/);
  });

  it('pullOllamaModel surfaces body error on non-ok (#456)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({ error: 'repository does not exist' }),
    }) as any;
    await expect(
      pullOllamaModel('nope', () => {}, 'http://x/api/pull'),
    ).rejects.toThrow(/repository does not exist/);
  });

  it('deleteOllamaModel surfaces body error on non-ok (#456)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({ error: "model 'ghost' not found" }),
    }) as any;
    await expect(
      deleteOllamaModel('ghost', 'http://x/api/delete'),
    ).rejects.toThrow(/model 'ghost' not found/);
  });

  // ── #476: model memory management (load / unload / running / version) ──────

  it('fetchRunningModels returns loaded models from /api/ps (#476)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'llama3:8b', model: 'llama3:8b', size: 6_000_000_000, size_vram: 5_000_000_000, expires_at: '2024-01-01T00:05:00Z', expires_relative_to_now: '4m59s' },
          { name: 'mistral:7b', model: 'mistral:7b', size: 4_000_000_000 },
        ],
      }),
    }) as any;
    const models = await fetchRunningModels('http://x/api/ps');
    expect(models).toHaveLength(2);
    expect(models[0].name).toBe('llama3:8b');
    expect(models[0].size).toBe(6_000_000_000);
    expect(models[0].sizeVram).toBe(5_000_000_000);
    expect(models[1].sizeVram).toBeUndefined();
  });

  it('fetchRunningModels returns empty array when no models loaded (#476)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    }) as any;
    const models = await fetchRunningModels('http://x/api/ps');
    expect(models).toEqual([]);
  });

  it('fetchRunningModels surfaces body error on non-ok (#476)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'ollama daemon crashed' }),
    }) as any;
    await expect(fetchRunningModels('http://x/api/ps')).rejects.toThrow(/ollama daemon crashed/);
  });

  it('loadOllamaModel sends POST with keep_alive (#476)', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
    global.fetch = mock;
    await loadOllamaModel('llama3:8b', 600, 'http://x/api/generate');
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, opts] = mock.mock.calls[0];
    expect(url).toBe('http://x/api/generate');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('llama3:8b');
    expect(body.keep_alive).toBe('600s');
    expect(body.stream).toBe(false);
  });

  it('loadOllamaModel surfaces body error on non-ok (#476)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({ error: "model 'ghost' not found" }),
    }) as any;
    await expect(loadOllamaModel('ghost', 300, 'http://x/api/generate')).rejects.toThrow(/model 'ghost' not found/);
  });

  it('unloadOllamaModel sends POST with keep_alive 0 (#476)', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
    global.fetch = mock;
    await unloadOllamaModel('llama3:8b', 'http://x/api/generate');
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, opts] = mock.mock.calls[0];
    expect(url).toBe('http://x/api/generate');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('llama3:8b');
    expect(body.keep_alive).toBe(0);
    expect(body.stream).toBe(false);
  });

  it('unloadOllamaModel surfaces body error on non-ok (#476)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({ error: "model 'ghost' not found" }),
    }) as any;
    await expect(unloadOllamaModel('ghost', 'http://x/api/generate')).rejects.toThrow(/model 'ghost' not found/);
  });

  it('fetchOllamaVersion returns version string (#476)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.3.14' }),
    }) as any;
    const info = await fetchOllamaVersion('http://x/api/version');
    expect(info.version).toBe('0.3.14');
  });

  it('fetchOllamaVersion surfaces body error on non-ok (#476)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Service Unavailable',
      json: async () => ({ error: 'server starting up' }),
    }) as any;
    await expect(fetchOllamaVersion('http://x/api/version')).rejects.toThrow(/server starting up/);
  });
});
import { fetchRunningModels, loadOllamaModel, unloadOllamaModel, fetchOllamaVersion } from '../services/ollama';
