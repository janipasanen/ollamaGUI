import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadConnections, saveConnections, addConnection, updateConnection, removeConnection,
  fetchOpenAiModels, fetchOllamaConnectionModels, fetchAllConnectionModels,
  buildOpenAiChatRequest, streamOpenAiChat, openAiErrorFromResponse,
  buildModelGroups, checkConnectionHealth,
  getLmStudioModels, testLmStudioConnection,
  type ModelConnection,
} from '../services/connections';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ── CRUD + persistence ────────────────────────────────────────────────────────

describe('Connection CRUD (#123)', () => {
  it('addConnection assigns id and persists', () => {
    // Clear localStorage first to start fresh
    localStorage.clear();
    const c = addConnection({ name: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234', enabled: true });
    expect(c.id).toBeTruthy();
    // After adding, should have 3 connections (local-ollama + lm-studio defaults + added)
    const conns = loadConnections();
    expect(conns).toHaveLength(3);
    expect(conns.find(conn => conn.name === 'LM Studio')).toBeDefined();
  });

  it('updateConnection patches the right entry', () => {
    const c = addConnection({ name: 'A', kind: 'openai', baseUrl: 'http://a', enabled: true });
    updateConnection(c.id, { enabled: false, apiKey: 'secret' });
    const updated = loadConnections().find(x => x.id === c.id)!;
    expect(updated.enabled).toBe(false);
    expect(updated.apiKey).toBe('secret');
  });

  it('removeConnection deletes from storage', () => {
    localStorage.clear(); // Start fresh
    const c = addConnection({ name: 'B', kind: 'ollama', baseUrl: 'http://b', enabled: true });
    removeConnection(c.id);
    // After removal, should still have the default connections (2)
    expect(loadConnections()).toHaveLength(2);
  });

  it('saveConnections + loadConnections round-trips', () => {
    localStorage.clear(); // Start fresh
    const conns: ModelConnection[] = [
      { id: 'x', name: 'X', kind: 'openai', baseUrl: 'http://x', enabled: true, apiKey: 'k' },
    ];
    saveConnections(conns);
    // After loading, should have the saved connection plus defaults
    const loaded = loadConnections();
    expect(loaded).toHaveLength(3); // x + local-ollama + lm-studio
    expect(loaded.find(c => c.id === 'x')).toEqual({ id: 'x', name: 'X', kind: 'openai', baseUrl: 'http://x', enabled: true, apiKey: 'k' });
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

// ── buildModelGroups (#554) ─────────────────────────────────────────────────

const localConn: ModelConnection = {
  id: 'local-ollama',
  name: 'Local Ollama',
  kind: 'ollama',
  baseUrl: 'http://localhost:11434',
  enabled: true,
};

const ollamaRemote: ModelConnection = {
  id: 'remote-a',
  name: 'Alpha',
  kind: 'ollama',
  baseUrl: 'http://remote-a:11434',
  enabled: true,
};

const openAiRemote: ModelConnection = {
  id: 'remote-b',
  name: 'Beta',
  kind: 'openai',
  baseUrl: 'http://remote-b:1234',
  enabled: true,
};

function connModel(id: string, name: string, extra: Partial<import('../services/connections').ConnectedModel> = {}) {
  return {
    id,
    name,
    connectionId: id.split('/')[0],
    connectionName: id.split('/')[0],
    kind: 'ollama' as const,
    ...extra,
  };
}

describe('buildModelGroups (#554)', () => {
  it('creates one group per enabled connection', () => {
    const groups = buildModelGroups([localConn, ollamaRemote, openAiRemote], []);
    expect(groups).toHaveLength(3);
  });

  it('groups models by their connection id', () => {
    const models = [
      connModel('local-ollama/llama3', 'llama3'),
      connModel('local-ollama/qwen3', 'qwen3'),
      connModel('remote-a/gemma', 'gemma'),
    ];
    const groups = buildModelGroups([localConn, ollamaRemote], models);
    const local = groups.find((g) => g.label === '— Local Ollama —');
    const remote = groups.find((g) => g.label === '— Remote Ollama: Alpha —');
    expect(local?.options).toHaveLength(2);
    expect(remote?.options).toHaveLength(1);
    expect(remote?.options[0].name).toBe('gemma');
  });

  it('relabels the local-ollama connection as "Local Ollama"', () => {
    const groups = buildModelGroups([localConn], []);
    expect(groups[0].label).toBe('— Local Ollama —');
  });

  it('labels ollama remotes as "Remote Ollama: <name>"', () => {
    const groups = buildModelGroups([ollamaRemote], []);
    expect(groups[0].label).toBe('— Remote Ollama: Alpha —');
  });

  it('labels non-ollama (openai) remotes without the "Remote Ollama" prefix', () => {
    const groups = buildModelGroups([openAiRemote], []);
    expect(groups[0].label).toBe('— Beta —');
  });

  it('excludes disabled connections', () => {
    const disabled: ModelConnection = {
      id: 'remote-c', name: 'Gamma', kind: 'ollama', baseUrl: 'http://c:11434', enabled: false,
    };
    const models = [connModel('remote-c/x', 'x')];
    const groups = buildModelGroups([localConn, disabled], models);
    expect(groups).toHaveLength(1);
  });

  it('keeps empty groups so no-config providers still appear', () => {
    const groups = buildModelGroups([localConn, ollamaRemote], []);
    expect(groups.every((g) => g.isEmpty === true)).toBe(true);
    expect(groups).toHaveLength(2);
  });

  it('sorts options by model tag and joins size/quantization as suffix', () => {
    const models = [
      connModel('local-ollama/zzz', 'zzz', { parameterSize: '7B', quantization: 'Q4_K_M' }),
      connModel('local-ollama/aaa', 'aaa'),
    ];
    const groups = buildModelGroups([localConn], models);
    const opts = groups[0].options;
    expect(opts.map((o) => o.name)).toEqual(['aaa', 'zzz']);
    expect(opts[1].suffix).toBe('7B · Q4_K_M');
  });

  it('prefixes cloud models with a cloud marker', () => {
    const models = [connModel('local-ollama/fancy', 'fancy', { cloud: true })];
    const groups = buildModelGroups([localConn], models);
    expect(groups[0].options[0].marker).toBe('⛅');
  });

  it('uses "<connectionId>/<name>" as the option value and key', () => {
    const models = [connModel('remote-a/gemma', 'gemma')];
    const groups = buildModelGroups([ollamaRemote], models);
    expect(groups[0].options[0].key).toBe('remote-a/gemma');
    expect(groups[0].options[0].value).toBe('remote-a/gemma');
  });
});


// ── Connection health status (#553 / G5) ────────────────────────────────────

describe('checkConnectionHealth (#553 / G5)', () => {
  it('probes /v1/models for an OpenAI-compatible connection', async () => {
    const conn: ModelConnection = {
      id: 'lm-studio', name: 'LM Studio', kind: 'openai',
      baseUrl: 'http://localhost:1234', enabled: true,
    };
    const calls: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ data: [] }) } as any;
    });

    const result = await checkConnectionHealth(conn);

    expect(result.status).toBe('healthy');
    expect(result.connectionId).toBe('lm-studio');
    expect(calls[0].url).toBe('http://localhost:1234/v1/models');
  });

  it('probes /api/tags for an Ollama connection', async () => {
    const conn: ModelConnection = {
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    };
    const calls: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ models: [] }) } as any;
    });

    const result = await checkConnectionHealth(conn);

    expect(result.status).toBe('healthy');
    expect(calls[0].url).toBe('http://localhost:11434/api/tags');
  });

  it('strips a trailing slash from baseUrl before probing', async () => {
    const conn: ModelConnection = {
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434/', enabled: true,
    };
    const calls: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calls.push({ url });
      return { ok: true, status: 200, json: async () => ({ models: [] }) } as any;
    });

    await checkConnectionHealth(conn);
    expect(calls[0].url).toBe('http://localhost:11434/api/tags');
  });

  it('classifies HTTP 401 as authError', async () => {
    const conn: ModelConnection = {
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 401, statusText: 'Unauthorized',
    } as any);

    const result = await checkConnectionHealth(conn);
    expect(result.status).toBe('authError');
    expect(result.detail).toContain('401');
  });

  it('classifies HTTP 403 as authError', async () => {
    const conn: ModelConnection = {
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 403, statusText: 'Forbidden',
    } as any);

    const result = await checkConnectionHealth(conn);
    expect(result.status).toBe('authError');
  });

  it('classifies other non-ok responses as unreachable', async () => {
    const conn: ModelConnection = {
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 503, statusText: 'Service Unavailable',
    } as any);

    const result = await checkConnectionHealth(conn);
    expect(result.status).toBe('unreachable');
    expect(result.detail).toContain('503');
  });

  it('classifies a fetch rejection (offline) as unreachable', async () => {
    const conn: ModelConnection = {
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    };
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('Failed to fetch'),
    );

    const result = await checkConnectionHealth(conn);
    expect(result.status).toBe('unreachable');
    expect(result.detail).toContain('Failed to fetch');
  });

  it('sends the Authorization header when an apiKey is set', async () => {
    const conn: ModelConnection = {
      id: 'lm-studio', name: 'LM Studio', kind: 'openai',
      baseUrl: 'http://localhost:1234', apiKey: 'secret', enabled: true,
    };
    const calls: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      calls.push({ opts });
      return { ok: true, status: 200, json: async () => ({ data: [] }) } as any;
    });

    await checkConnectionHealth(conn);
    expect(calls[0].opts.headers['Authorization']).toBe('Bearer secret');
  });

  it('does not send an Authorization header when no apiKey is set', async () => {
    const conn: ModelConnection = {
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    };
    const calls: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      calls.push({ opts });
      return { ok: true, status: 200, json: async () => ({ models: [] }) } as any;
    });

    await checkConnectionHealth(conn);
    expect(calls[0].opts.headers).toBeDefined();
    expect(calls[0].opts.headers['Authorization']).toBeUndefined();
  });
});

// ── LM Studio helpers (G4 — OpenAI-compatible) ────────────────────────────────

describe('getLmStudioModels (G4)', () => {
  it('maps /v1/models into ConnectedModel entries tagged as lm-studio-temp', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'llama3.2' }, { id: 'mistral' }] }),
    } as any);
    const models = await getLmStudioModels('http://localhost:1234');
    expect(models).toHaveLength(2);
    expect(models[0].name).toBe('llama3.2');
    expect(models[0].connectionId).toBe('lm-studio-temp');
    expect(models[0].connectionName).toBe('LM Studio');
    expect(models[0].kind).toBe('openai');
    expect(models[0].id).toBe('lm-studio-temp/llama3.2');
  });

  it('strips a trailing slash from the base URL before appending /v1/models', async () => {
    const calls: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, opts) => {
      calls.push({ url });
      return { ok: true, json: async () => ({ data: [] }) } as any;
    });
    await getLmStudioModels('http://localhost:1234/');
    expect(calls[0].url).toBe('http://localhost:1234/v1/models');
  });

  it('returns [] on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false } as any);
    expect(await getLmStudioModels()).toEqual([]);
  });

  it('returns [] on a fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('fetch failed'));
    expect(await getLmStudioModels()).toEqual([]);
  });
});

describe('testLmStudioConnection (G4)', () => {
  const conn: ModelConnection = {
    id: 'lmstudio', name: 'LM Studio', kind: 'openai',
    baseUrl: 'http://localhost:1234', enabled: true,
  };

  it('reports success and parses models from /v1/models', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ data: [{ id: 'gpt-j' }] }),
    } as any);
    const result = await testLmStudioConnection(conn);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.models).toHaveLength(1);
    expect(result.models[0].id).toBe('lmstudio/gpt-j');
  });

  it('sends the Authorization header when apiKey is set', async () => {
    const calls: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, opts) => {
      calls.push({ opts });
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ data: [] }) } as any;
    });
    await testLmStudioConnection({ ...conn, apiKey: 'secret' });
    expect(calls[0].opts.headers['Authorization']).toBe('Bearer secret');
  });

  it('returns failure with the HTTP status on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 500, statusText: 'Internal Server Error',
    } as any);
    const result = await testLmStudioConnection(conn);
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 500');
    expect(result.models).toEqual([]);
  });

  it('returns failure with the fetch message on a fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const result = await testLmStudioConnection(conn);
    expect(result.success).toBe(false);
    expect(result.error).toContain('connect ECONNREFUSED');
  });
});
