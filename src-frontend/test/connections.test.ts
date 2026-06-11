import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadConnections, saveConnections, addConnection, updateConnection, removeConnection,
  fetchOpenAiModels, fetchOllamaConnectionModels, fetchAllConnectionModels,
  buildOpenAiChatRequest, streamOpenAiChat,
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
});
