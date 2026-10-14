import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadConnections, saveConnections, addConnection, updateConnection, removeConnection,
  fetchOpenAiModels, fetchOllamaConnectionModels, fetchAllConnectionModels,
  buildOpenAiChatRequest, streamOpenAiChat, openAiErrorFromResponse,
  isOpenAiCompatible, normalizeBaseUrl, deltaReasoning, DEFAULT_PORTS, toOpenAiSampling,
  type ModelConnection,
} from '../services/connections';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ── CRUD + persistence ────────────────────────────────────────────────────────

describe('Connection CRUD (#123)', () => {
  it('addConnection assigns id and persists', () => {
    const c = addConnection({ name: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true });
    expect(c.id).toBeTruthy();
    expect(loadConnections()).toHaveLength(1);
  });

  it('updateConnection patches the right entry', () => {
    const c = addConnection({ name: 'A', kind: 'openai', baseUrl: 'http://a', enabled: true });
    updateConnection(c.id, { enabled: false, apiKey: 'secret' });
    const updated = loadConnections().find(x => x.id === c.id)!;
    expect(updated.enabled).toBe(false);
    expect(updated.apiKey).toBe('secret');
  });

  it('removeConnection deletes from storage', () => {
    const c = addConnection({ name: 'B', kind: 'ollama', baseUrl: 'http://b', enabled: true });
    removeConnection(c.id);
    expect(loadConnections()).toHaveLength(0);
  });

  it('saveConnections + loadConnections round-trips', () => {
    const conns: ModelConnection[] = [
      { id: 'x', name: 'X', kind: 'openai', baseUrl: 'http://x', enabled: true, apiKey: 'k' },
    ];
    saveConnections(conns);
    expect(loadConnections()).toEqual(conns);
  });
});

// ── Model fetching ────────────────────────────────────────────────────────────

describe('fetchOpenAiModels (#123)', () => {
  const conn: ModelConnection = { id: 'lmstudio', name: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };

  it('parses /v1/models response into ConnectedModel list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'mistral-7b-v0.1' }, { id: 'llama3-8b' }] }),
    } as any);
    const models = await fetchOpenAiModels(conn);
    expect(models).toHaveLength(2);
    expect(models[0].name).toBe('mistral-7b-v0.1');
    expect(models[0].connectionId).toBe('lmstudio');
    expect(models[0].connectionName).toBe('LM Studio');
    expect(models[0].kind).toBe('openai');
    expect(models[0].id).toBe('lmstudio/mistral-7b-v0.1');
  });

  it('sends Authorization header when apiKey is set', async () => {
    const calls: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, json: async () => ({ data: [] }) } as any;
    });
    await fetchOpenAiModels({ ...conn, apiKey: 'my-key' });
    expect(calls[0].opts.headers['Authorization']).toBe('Bearer my-key');
  });

  it('returns empty array on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false } as any);
    expect(await fetchOpenAiModels(conn)).toEqual([]);
  });

  it('returns empty array on fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network Error'));
    expect(await fetchOpenAiModels(conn)).toEqual([]);
  });
});

describe('fetchOllamaConnectionModels (#123)', () => {
  const conn: ModelConnection = { id: 'lan-ollama', name: 'LAN Ollama', kind: 'ollama', baseUrl: 'http://192.168.1.5:11434', enabled: true };

  it('parses /api/tags response into ConnectedModel list with metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          { name: 'llama3.1:8b', size: 4_700_000_000, details: { quantization_level: 'Q4_K_M', parameter_size: '8B' } },
        ],
      }),
    } as any);
    const models = await fetchOllamaConnectionModels(conn);
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('llama3.1:8b');
    expect(models[0].connectionId).toBe('lan-ollama');
    expect(models[0].size).toBe(4_700_000_000);
    expect(models[0].quantization).toBe('Q4_K_M');
  });

  it('returns empty array on error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'));
    expect(await fetchOllamaConnectionModels(conn)).toEqual([]);
  });
});

describe('fetchAllConnectionModels (#123)', () => {
  it('aggregates models from all enabled connections', async () => {
    const openai: ModelConnection = { id: 'oa', name: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };
    const ollama: ModelConnection = { id: 'ol', name: 'LAN', kind: 'ollama', baseUrl: 'http://192.168.1.5:11434', enabled: true };
    const disabled: ModelConnection = { id: 'dis', name: 'Off', kind: 'openai', baseUrl: 'http://off', enabled: false };

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'gpt2' }] }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [{ name: 'llama3.2:1b' }] }) } as any);

    const models = await fetchAllConnectionModels([openai, ollama, disabled]);
    expect(models).toHaveLength(2);
    expect(models.map(m => m.connectionId)).toContain('oa');
    expect(models.map(m => m.connectionId)).toContain('ol');
    expect(models.map(m => m.connectionId)).not.toContain('dis');
  });

  it('skips a failed connection and returns the rest', async () => {
    const a: ModelConnection = { id: 'a', name: 'A', kind: 'openai', baseUrl: 'http://a', enabled: true };
    const b: ModelConnection = { id: 'b', name: 'B', kind: 'openai', baseUrl: 'http://b', enabled: true };
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('fail A'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'model-b' }] }) } as any);
    const models = await fetchAllConnectionModels([a, b]);
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('model-b');
  });
});

// ── Request construction ───────────────────────────────────────────────────────

describe('buildOpenAiChatRequest (#123)', () => {
  const conn: ModelConnection = { id: 'c1', name: 'C1', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };

  it('builds correct URL and body', () => {
    const req = buildOpenAiChatRequest(conn, 'gpt-4', [{ role: 'user', content: 'hi' }]);
    expect(req.url).toBe('http://localhost:1234/v1/chat/completions');
    expect(JSON.parse(req.body).model).toBe('gpt-4');
    expect(JSON.parse(req.body).stream).toBe(true);
  });

  it('injects Authorization Bearer header', () => {
    const req = buildOpenAiChatRequest({ ...conn, apiKey: 'sk-123' }, 'm', []);
    expect(req.headers['Authorization']).toBe('Bearer sk-123');
  });

  it('strips trailing slash from baseUrl', () => {
    const req = buildOpenAiChatRequest({ ...conn, baseUrl: 'http://localhost:1234/' }, 'm', []);
    expect(req.url).toBe('http://localhost:1234/v1/chat/completions');
  });
});

// ── SSE stream parsing ────────────────────────────────────────────────────────

describe('streamOpenAiChat — SSE parsing (#123)', () => {
  const conn: ModelConnection = { id: 'lm', name: 'LM', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };

  function mockSse(lines: string[]) {
    const encoder = new TextEncoder();
    let i = 0;
    const body = new ReadableStream({
      pull(ctrl) {
        if (i < lines.length) ctrl.enqueue(encoder.encode(lines[i++] + '\n'));
        else ctrl.close();
      },
    });
    return { ok: true, status: 200, body } as any;
  }

  it('extracts content deltas from SSE stream', async () => {
    const chunks: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve(mockSse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]',
    ])));
    await streamOpenAiChat(conn, 'gpt-4', [], d => chunks.push(d));
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('stops at [DONE] sentinel', async () => {
    const chunks: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve(mockSse([
      'data: {"choices":[{"delta":{"content":"A"}}]}',
      'data: [DONE]',
      'data: {"choices":[{"delta":{"content":"B"}}]}',
    ])));
    await streamOpenAiChat(conn, 'gpt-4', [], d => chunks.push(d));
    expect(chunks).toEqual(['A']);
  });

  it('skips non-data SSE lines', async () => {
    const chunks: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve(mockSse([
      ': ping',
      'data: {"choices":[{"delta":{"content":"X"}}]}',
      'data: [DONE]',
    ])));
    await streamOpenAiChat(conn, 'gpt-4', [], d => chunks.push(d));
    expect(chunks).toEqual(['X']);
  });

  it('throws on non-ok HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, statusText: 'Unauthorized' } as any);
    await expect(streamOpenAiChat(conn, 'gpt-4', [], () => {})).rejects.toThrow('OpenAI stream error');
  });

  // ── #458: surface response body error on non-ok ──────────────────────────

  it('openAiErrorFromResponse extracts nested error.message (#458)', async () => {
    const res = { statusText: 'Unauthorized', json: async () => ({ error: { message: 'Invalid API key provided' } }) } as any;
    const err = await openAiErrorFromResponse(res, 'OpenAI stream error');
    expect(err.message).toBe('OpenAI stream error: Invalid API key provided');
  });

  it('openAiErrorFromResponse extracts string error (#458)', async () => {
    const res = { statusText: 'Bad Request', json: async () => ({ error: 'model not found' }) } as any;
    const err = await openAiErrorFromResponse(res, 'OpenAI stream error');
    expect(err.message).toBe('OpenAI stream error: model not found');
  });

  it('openAiErrorFromResponse extracts top-level message/detail (#458)', async () => {
    const res = { statusText: 'Internal Server Error', json: async () => ({ detail: 'GPU out of memory' }) } as any;
    const err = await openAiErrorFromResponse(res, 'OpenAI stream error');
    expect(err.message).toBe('OpenAI stream error: GPU out of memory');
  });

  it('openAiErrorFromResponse falls back to statusText when no body error (#458)', async () => {
    const res = { statusText: 'Forbidden', json: async () => ({ models: [] }) } as any;
    const err = await openAiErrorFromResponse(res, 'OpenAI stream error');
    expect(err.message).toBe('OpenAI stream error: Forbidden');
  });

  it('openAiErrorFromResponse falls back to statusText when json() throws (#458)', async () => {
    const res = { statusText: 'Service Unavailable', json: async () => { throw new SyntaxError('nope'); } } as any;
    const err = await openAiErrorFromResponse(res, 'OpenAI stream error');
    expect(err.message).toBe('OpenAI stream error: Service Unavailable');
  });

  it('streamOpenAiChat surfaces body error.message on non-ok (#458)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      statusText: 'Unauthorized',
      json: async () => ({ error: { message: 'Invalid API key provided' } }),
    } as any);
    await expect(streamOpenAiChat(conn, 'gpt-4', [], () => {})).rejects.toThrow('Invalid API key provided');
  });

  it('passes reasoning_content deltas as the second onChunk arg (#244)', async () => {
    const deltas: string[] = [];
    const reasons: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve(mockSse([
      'data: {"choices":[{"delta":{"reasoning_content":"thinking step"}}]}',
      'data: {"choices":[{"delta":{"content":"answer"}}]}',
      'data: [DONE]',
    ])));
    await streamOpenAiChat(conn, 'gpt-4', [], (d, r) => { if (d) deltas.push(d); if (r) reasons.push(r); });
    expect(deltas).toEqual(['answer']);
    expect(reasons).toEqual(['thinking step']);
  });

  it('passes delta.thinking as reasoning (#244)', async () => {
    const reasons: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve(mockSse([
      'data: {"choices":[{"delta":{"thinking":"cot"}}]}',
      'data: [DONE]',
    ])));
    await streamOpenAiChat(conn, 'gpt-4', [], (_d, r) => { if (r) reasons.push(r); });
    expect(reasons).toEqual(['cot']);
  });
});

// ── #466: flush trailing SSE event without newline ───────────────────────────

describe('streamOpenAiChat — SSE flush (#466)', () => {
  const conn: ModelConnection = { id: 'lm', name: 'LM', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };

  function mockSseNoTrailingNewline(lines: string[]) {
    const encoder = new TextEncoder();
    let i = 0;
    const body = new ReadableStream({
      pull(ctrl) {
        if (i < lines.length) {
          const isLast = i === lines.length - 1;
          ctrl.enqueue(encoder.encode(lines[i++] + (isLast ? '' : '\n')));
        } else ctrl.close();
      },
    });
    return { ok: true, status: 200, body } as any;
  }

  it('flushes the last SSE event when it has no trailing newline (#466)', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve(mockSseNoTrailingNewline([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: {"choices":[{"delta":{"content":"!"}}]}',
    ])));
    const chunks: string[] = [];
    await streamOpenAiChat(conn, 'gpt-4', [], d => chunks.push(d));
    expect(chunks).toEqual(['Hello', ' world', '!']);
  });

  it('flushes trailing [DONE] without newline and stops (#466)', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve(mockSseNoTrailingNewline([
      'data: {"choices":[{"delta":{"content":"A"}}]}',
      'data: [DONE]',
    ])));
    const chunks: string[] = [];
    await streamOpenAiChat(conn, 'gpt-4', [], d => chunks.push(d));
    expect(chunks).toEqual(['A']);
  });
});

// ── #469: SSE data: field without space after colon ───────────────────────────

describe('streamOpenAiChat — SSE data: without space (#469)', () => {
  const conn: ModelConnection = { id: 'lm', name: 'LM', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };

  function mockSse(lines: string[]) {
    const encoder = new TextEncoder();
    let i = 0;
    const body = new ReadableStream({
      pull(ctrl) {
        if (i < lines.length) ctrl.enqueue(encoder.encode(lines[i++] + '\n'));
        else ctrl.close();
      },
    });
    return { ok: true, status: 200, body } as any;
  }

  it('parses data:{...} without space after colon (#469)', async () => {
    const chunks: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve(mockSse([
      'data:{"choices":[{"delta":{"content":"Hello"}}]}',
      'data:{"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]',
    ])));
    await streamOpenAiChat(conn, 'gpt-4', [], d => chunks.push(d));
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('parses data:{...} without space in flush buffer (#469)', async () => {
    const encoder = new TextEncoder();
    let i = 0;
    const lines = [
      'data:{"choices":[{"delta":{"content":"A"}}]}',
      'data:{"choices":[{"delta":{"content":"B"}}]}',  // no trailing newline
    ];
    const body = new ReadableStream({
      pull(ctrl) {
        if (i < lines.length) {
          const isLast = i === lines.length - 1;
          ctrl.enqueue(encoder.encode(lines[i++] + (isLast ? '' : '\n')));
        } else ctrl.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve({ ok: true, status: 200, body } as any));
    const chunks: string[] = [];
    await streamOpenAiChat(conn, 'gpt-4', [], d => chunks.push(d));
    expect(chunks).toEqual(['A', 'B']);
  });
});

describe('streamOpenAiChat — Qwen inline reasoning (#551)', () => {
  const conn: ModelConnection = { id: 'lm', name: 'LM', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };

  function mockSse(lines: string[]) {
    const encoder = new TextEncoder();
    let i = 0;
    const body = new ReadableStream({
      pull(ctrl) {
        if (i < lines.length) ctrl.enqueue(encoder.encode(lines[i++] + '\n'));
        else ctrl.close();
      },
    });
    return { ok: true, status: 200, body } as any;
  }

  it('routes <think> spans to the reasoning channel even when the tag straddles frames', async () => {
    // Qwen on LM Studio streams its scratchpad inline in `content`; unsplit,
    // it renders in the chat bubble as if it were the answer.
    const deltas: string[] = [];
    const reasons: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve(mockSse([
      'data: {"choices":[{"delta":{"content":"<thi"}}]}',
      'data: {"choices":[{"delta":{"content":"nk>weighing options</think>Use "}}]}',
      'data: {"choices":[{"delta":{"content":"a HashMap."}}]}',
      'data: [DONE]',
    ])));
    await streamOpenAiChat(conn, 'qwen/qwen3-coder-next', [], (d, r) => {
      if (d) deltas.push(d);
      if (r) reasons.push(r);
    });
    expect(deltas.join('')).toBe('Use a HashMap.');
    expect(reasons.join('')).toBe('weighing options');
  });

  it('flushes a trailing partial tag instead of swallowing it', async () => {
    // "5 < 3" ends the reply on a lone angle bracket — the filter holds it
    // back waiting for "<think>", so the stream end must release it.
    const deltas: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve(mockSse([
      'data: {"choices":[{"delta":{"content":"answer <"}}]}',
      'data: [DONE]',
    ])));
    await streamOpenAiChat(conn, 'qwen/qwen3-coder-next', [], d => { if (d) deltas.push(d); });
    expect(deltas.join('')).toBe('answer <');
  });

  it('passes <tool_call> markup through as text instead of deleting it', async () => {
    // Plain chat has no tool loop to consume a withheld tool-call channel, so
    // diverting those spans here would silently erase them: a model
    // *explaining* the format would lose its example mid-sentence.
    const deltas: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve(mockSse([
      'data: {"choices":[{"delta":{"content":"For example: <tool_call>{\\"name\\":\\"x\\"}</tool_call> clear?"}}]}',
      'data: [DONE]',
    ])));
    await streamOpenAiChat(conn, 'qwen/qwen3-coder-next', [], d => { if (d) deltas.push(d); });
    expect(deltas.join('')).toBe('For example: <tool_call>{"name":"x"}</tool_call> clear?');
  });

  it('leaves a reply with no think tags byte-identical', async () => {
    const deltas: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(Promise.resolve(mockSse([
      'data: {"choices":[{"delta":{"content":"plain "}}]}',
      'data: {"choices":[{"delta":{"content":"answer"}}]}',
      'data: [DONE]',
    ])));
    await streamOpenAiChat(conn, 'qwen/qwen3-coder-next', [], d => { if (d) deltas.push(d); });
    expect(deltas.join('')).toBe('plain answer');
  });
});

// ── vLLM as a first-class provider (#552) ────────────────────────────────────

describe('vLLM provider kind (#552)', () => {
  it('routes vLLM through the OpenAI /v1 dialect, not Ollama /api', () => {
    // The old dispatch was `kind === 'openai' ? openai : ollama`, so any new
    // kind silently fell through to /api/tags and listed nothing.
    expect(isOpenAiCompatible('vllm')).toBe(true);
    expect(isOpenAiCompatible('openai')).toBe(true);
    expect(isOpenAiCompatible('ollama')).toBe(false);
    expect(isOpenAiCompatible(undefined)).toBe(false);
  });

  it('lists vLLM models from /v1/models', async () => {
    const conn: ModelConnection = { id: 'v1', name: 'gx10', kind: 'vllm', baseUrl: 'http://gx10:8000', enabled: true };
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(((url: any) => {
      calls.push(String(url));
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [{ id: 'nvidia/Qwen3.6-35B-A3B-NVFP4' }] }),
      });
    }) as any);

    const models = await fetchAllConnectionModels([conn]);
    expect(calls[0]).toBe('http://gx10:8000/v1/models');
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: 'v1/nvidia/Qwen3.6-35B-A3B-NVFP4',
      name: 'nvidia/Qwen3.6-35B-A3B-NVFP4',
      connectionName: 'gx10',
      kind: 'vllm',
    });
  });

  it('aggregates models from several providers into one list', async () => {
    // The unified selector is the whole point: one list, every provider.
    const conns: ModelConnection[] = [
      { id: 'v', name: 'gx10', kind: 'vllm', baseUrl: 'http://gx10:8000', enabled: true },
      { id: 'l', name: 'LM', kind: 'openai', baseUrl: 'http://lm:1234', enabled: true },
      { id: 'off', name: 'Disabled', kind: 'vllm', baseUrl: 'http://nope:8000', enabled: false },
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(((url: any) => Promise.resolve({
      ok: true,
      json: async () => ({ data: [{ id: String(url).includes('gx10') ? 'qwen-vllm' : 'qwen-lm' }] }),
    })) as any);

    const models = await fetchAllConnectionModels(conns);
    expect(models.map(m => m.name).sort()).toEqual(['qwen-lm', 'qwen-vllm']);
    // A disabled provider contributes nothing.
    expect(models.some(m => m.connectionId === 'off')).toBe(false);
  });
});

describe('normalizeBaseUrl (#552)', () => {
  it('completes a bare host with scheme and the provider default port', () => {
    // "gx10" is what people actually type; without this it becomes an
    // uncallable URL and every request fails with an opaque network error.
    expect(normalizeBaseUrl('gx10', 'vllm')).toBe('http://gx10:8000');
    expect(normalizeBaseUrl('gx10', 'ollama')).toBe('http://gx10:11434');
    expect(normalizeBaseUrl('gx10', 'openai')).toBe('http://gx10:1234');
  });

  it('never overrides a port or scheme the user gave', () => {
    expect(normalizeBaseUrl('http://gx10:9999', 'vllm')).toBe('http://gx10:9999');
    expect(normalizeBaseUrl('https://api.example.com', 'openai')).toBe('https://api.example.com');
    expect(normalizeBaseUrl('gx10:8080', 'vllm')).toBe('http://gx10:8080');
  });

  it('takes a URL written with a scheme exactly as given', () => {
    // Writing the scheme is how a user says "this is the whole URL". Forcing
    // a port onto it made a server behind nginx/a tunnel — reached on port 80
    // — unreachable, and `parsed.port` reads '' for a default port, so an
    // explicit ':80' could not be distinguished from no port at all.
    expect(normalizeBaseUrl('http://ai.example.com', 'ollama')).toBe('http://ai.example.com');
    expect(normalizeBaseUrl('http://ai.example.com:80', 'ollama')).toBe('http://ai.example.com');
    expect(normalizeBaseUrl('http://gateway/ollama', 'ollama')).toBe('http://gateway/ollama');
  });

  it('drops a trailing /v1 for OpenAI-dialect providers', () => {
    // vLLM's and LM Studio's own docs print the endpoint WITH /v1, and every
    // call site appends its own — pasting the documented URL produced
    // /v1/v1/models and a 404 that surfaced only as "could not fetch models".
    expect(normalizeBaseUrl('http://gx10:8000/v1', 'vllm')).toBe('http://gx10:8000');
    expect(normalizeBaseUrl('http://localhost:1234/v1', 'openai')).toBe('http://localhost:1234');
    expect(normalizeBaseUrl('gx10/v1', 'vllm')).toBe('http://gx10:8000');
    // A deeper reverse-proxy mount keeps its prefix; only the /v1 goes.
    expect(normalizeBaseUrl('http://proxy/llm/v1', 'vllm')).toBe('http://proxy/llm');
    // Ollama does not speak /v1, so its paths are left alone.
    expect(normalizeBaseUrl('http://gateway/v1', 'ollama')).toBe('http://gateway/v1');
  });

  it('strips trailing slashes and tolerates blank input', () => {
    expect(normalizeBaseUrl('http://gx10:8000/', 'vllm')).toBe('http://gx10:8000');
    expect(normalizeBaseUrl('  ', 'vllm')).toBe('');
    expect(normalizeBaseUrl('  gx10  ', 'vllm')).toBe('http://gx10:8000');
  });

  it('leaves an https URL on its implicit port', () => {
    // Forcing :8000 onto an https endpoint would break every hosted provider.
    expect(normalizeBaseUrl('https://api.example.com', 'vllm')).toBe('https://api.example.com');
  });

  it('handles IPv6 literals', () => {
    // "[::1]" ends in ']' so it reads as portless; "[::1]:8000" does not.
    expect(normalizeBaseUrl('[::1]', 'vllm')).toBe('http://[::1]:8000');
    expect(normalizeBaseUrl('http://[::1]:8000', 'vllm')).toBe('http://[::1]:8000');
  });

  it('documents the conventional port per provider', () => {
    expect(DEFAULT_PORTS.vllm).toBe(8000);
    expect(DEFAULT_PORTS.ollama).toBe(11434);
  });
});

describe('deltaReasoning — reasoning field per server (#552)', () => {
  it('reads vLLM\'s `reasoning` alongside the commoner field names', () => {
    // vLLM 0.28 streams `reasoning`; reading only reasoning_content/thinking
    // made a vLLM reasoning model look silent — every token was discarded.
    expect(deltaReasoning({ reasoning: 'vllm thinking' })).toBe('vllm thinking');
    expect(deltaReasoning({ reasoning_content: 'lm studio' })).toBe('lm studio');
    expect(deltaReasoning({ thinking: 'ollama-style' })).toBe('ollama-style');
    expect(deltaReasoning({ content: 'not reasoning' })).toBe('');
    expect(deltaReasoning(undefined)).toBe('');
  });

  it('streams vLLM reasoning onto the reasoning channel, not the chat bubble', async () => {
    const conn: ModelConnection = { id: 'v', name: 'gx10', kind: 'vllm', baseUrl: 'http://gx10:8000', enabled: true };
    const encoder = new TextEncoder();
    const lines = [
      'data: {"choices":[{"delta":{"reasoning":"weighing "}}]}',
      'data: {"choices":[{"delta":{"reasoning":"options"}}]}',
      'data: {"choices":[{"delta":{"content":"Use a HashMap."}}]}',
      'data: [DONE]',
    ];
    let i = 0;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200,
      body: new ReadableStream({
        pull(ctrl) {
          if (i < lines.length) ctrl.enqueue(encoder.encode(lines[i++] + '\n'));
          else ctrl.close();
        },
      }),
    } as any);

    const deltas: string[] = [];
    const reasons: string[] = [];
    await streamOpenAiChat(conn, 'nvidia/Qwen3.6-35B-A3B-NVFP4', [], (d, r) => {
      if (d) deltas.push(d);
      if (r) reasons.push(r);
    });
    expect(reasons.join('')).toBe('weighing options');
    expect(deltas.join('')).toBe('Use a HashMap.');
  });
});


// ── Generation options on the OpenAI dialect (#568) ──────────────────────────

describe('toOpenAiSampling (#568)', () => {
  const local: ModelConnection = { id: 'l', name: 'LM', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };
  const vllm: ModelConnection = { id: 'v', name: 'gx10', kind: 'vllm', baseUrl: 'http://gx10:8000', enabled: true };
  const gateway: ModelConnection = { ...local, apiKey: 'sk-123' };

  it('renames num_predict to max_tokens and passes temperature and top_p', () => {
    expect(toOpenAiSampling({ num_predict: 512, temperature: 0.4, top_p: 0.9 }, local))
      .toEqual({ max_tokens: 512, temperature: 0.4, top_p: 0.9 });
  });

  it('drops the -1 "unlimited" sentinel, which OpenAI cannot express', () => {
    expect(toOpenAiSampling({ num_predict: -1 }, local)).toEqual({});
  });

  it('drops an empty stop array', () => {
    // `/stop clear` leaves stop: [], which survives cleanGenerationOptions;
    // posting it makes some servers 400.
    expect(toOpenAiSampling({ stop: [] }, local)).toEqual({});
    expect(toOpenAiSampling({ stop: ['END'] }, local)).toEqual({ stop: ['END'] });
  });

  it('never forwards num_ctx — it has no chat-completions equivalent', () => {
    // It stays meaningful client-side: it drives compaction and the context
    // meter. It just is not a wire parameter.
    expect(toOpenAiSampling({ num_ctx: 8192 }, local)).toEqual({});
  });

  it('sends top_k only where it is known-safe', () => {
    // Not an OpenAI parameter: vLLM and keyless local servers accept it, a
    // strict gateway answers 400 "Unrecognized request argument".
    expect(toOpenAiSampling({ top_k: 40 }, vllm)).toEqual({ top_k: 40 });
    expect(toOpenAiSampling({ top_k: 40 }, local)).toEqual({ top_k: 40 });
    expect(toOpenAiSampling({ top_k: 40 }, gateway)).toEqual({});
  });

  it('omits every key the user has not set', () => {
    expect(toOpenAiSampling({}, local)).toEqual({});
    expect(toOpenAiSampling(undefined, local)).toEqual({});
  });

  it('reaches the request body rather than being spread raw', () => {
    const req = buildOpenAiChatRequest(local, 'm', [{ role: 'user', content: 'hi' }],
      { num_predict: 256, num_ctx: 8192, stop: [], temperature: 0.2 });
    const body = JSON.parse(req.body);
    expect(body.max_tokens).toBe(256);
    expect(body.temperature).toBe(0.2);
    expect(body).not.toHaveProperty('num_ctx');
    expect(body).not.toHaveProperty('num_predict');
    expect(body).not.toHaveProperty('stop');
  });
});
