import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadConnections, saveConnections, addConnection, updateConnection, removeConnection,
  fetchOpenAiModels, fetchOllamaConnectionModels, fetchAllConnectionModels, probeConnection,
  buildOpenAiChatRequest, streamOpenAiChat, openAiErrorFromResponse,
  type ModelConnection,
} from '../services/connections';
import { translateOpenAiSamplingOptions, openAiResponseFormat } from '../services/ollama';

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

// ── probeConnection (#589) ────────────────────────────────────────────────────
// A single-connection probe that keeps the reason it failed, so the UI can
// distinguish "reachable but empty" from "down" instead of deriving reachability
// from a model count.

describe('probeConnection (#589)', () => {
  it('reachable-but-empty OpenAI server: models [] and NO error', async () => {
    const conn: ModelConnection = { id: 'oa', name: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    } as any);
    const probe = await probeConnection(conn);
    expect(probe.models).toEqual([]);
    expect(probe.error).toBeUndefined();
  });

  it('reachable-but-empty Ollama server: models [] and NO error', async () => {
    const conn: ModelConnection = { id: 'ol', name: 'LAN', kind: 'ollama', baseUrl: 'http://192.168.1.5:11434', enabled: true };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    } as any);
    const probe = await probeConnection(conn);
    expect(probe.models).toEqual([]);
    expect(probe.error).toBeUndefined();
  });

  it('401 OpenAI server: error carries the token hint (#589)', async () => {
    const conn: ModelConnection = { id: 'oa', name: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: { message: 'Invalid API key provided' } }),
    } as any);
    const probe = await probeConnection(conn);
    expect(probe.error).toBeTruthy();
    expect(probe.error).toMatch(/401/);
    expect(probe.error).toMatch(/API key/i);
  });

  it('401 Ollama server: error mentions the token requirement', async () => {
    const conn: ModelConnection = { id: 'ol', name: 'LAN', kind: 'ollama', baseUrl: 'http://192.168.1.5:11434', apiKey: 'tok', enabled: true };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({}),
    } as any);
    const probe = await probeConnection(conn);
    expect(probe.error).toMatch(/401/);
    expect(probe.error).toMatch(/token/i);
  });

  it('404 without a body still reports the status', async () => {
    const conn: ModelConnection = { id: 'oa', name: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    } as any);
    const probe = await probeConnection(conn);
    expect(probe.error).toMatch(/404/);
  });

  it('thrown fetch: error is a non-empty provider-aware message', async () => {
    const conn: ModelConnection = { id: 'oa', name: 'LM Studio', kind: 'openai', baseUrl: 'http://remote:1234', enabled: true };
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Failed to fetch'));
    const probe = await probeConnection(conn);
    expect(probe.error).toBeTruthy();
    // The error names the host (openai-compatible path), not "run ollama serve".
    expect(probe.error).toContain('LM Studio');
  });

  it('ignores the `enabled` toggle — a disabled connection is still probed (#589)', async () => {
    const conn: ModelConnection = { id: 'off', name: 'Off', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: false };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'loaded' }] }),
    } as any);
    const probe = await probeConnection(conn);
    expect(probe.models).toHaveLength(1);
    expect(probe.error).toBeUndefined();
  });

  it('fetchOpenAiModels still returns [] on error (regression)', async () => {
    const conn: ModelConnection = { id: 'oa', name: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));
    expect(await fetchOpenAiModels(conn)).toEqual([]);
  });
});

describe('OpenAI option translation (#583)', () => {
  it('translates Ollama sampling options to OpenAI top-level fields', () => {
    const out = translateOpenAiSamplingOptions({ temperature: 0.3, num_predict: 100, top_p: 0.9, stop: ['\n'], num_ctx: 4096, top_k: 50 });
    expect(out.temperature).toBe(0.3);
    expect(out.max_tokens).toBe(100);
    expect(out.top_p).toBe(0.9);
    expect(out.stop).toEqual(['\n']);
    // Ollama-only / OpenAI-ignored fields must NOT be forwarded.
    expect(out.num_predict).toBeUndefined();
    expect(out.num_ctx).toBeUndefined();
    expect(out.top_k).toBeUndefined();
  });

  it('keeps num_predict=-1 as unlimited (no max_tokens)', () => {
    const out = translateOpenAiSamplingOptions({ num_predict: -1, temperature: 0.5 });
    expect(out.max_tokens).toBeUndefined();
    expect(out.temperature).toBe(0.5);
  });

  it('returns {} for undefined options', () => {
    expect(translateOpenAiSamplingOptions(undefined)).toEqual({});
  });

  it('converts json_object for the json flag', () => {
    expect(openAiResponseFormat('json')).toEqual({ type: 'json_object' });
  });

  it('converts a schema object with name + strict (LM Studio/vLLM require name)', () => {
    const schema = { type: 'object', properties: {} };
    const rf = openAiResponseFormat(schema);
    expect((rf as { type: string }).type).toBe('json_schema');
    const js = rf as { json_schema: { name: string; strict?: boolean } };
    expect(js.json_schema.name).toBe('response');
    expect(js.json_schema.strict).toBe(true);
  });

  it('streams translated options through buildOpenAiChatRequest body (not nested)', () => {
    const conn: ModelConnection = { id: 'oa', name: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true };
    const { body } = buildOpenAiChatRequest(conn, 'm', [{ role: 'user', content: 'hi' }] as any, { temperature: 0.2, num_predict: 50 });
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed.temperature).toBe(0.2);
    expect(parsed.max_tokens).toBe(50);
    expect(parsed.options).toBeUndefined();
  });
});
