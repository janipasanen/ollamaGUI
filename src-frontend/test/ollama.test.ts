import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchOllamaModels, pullOllamaModel, deleteOllamaModel, SUGGESTED_MODELS, fetchOllamaChatStream, cleanGenerationOptions } from '../services/ollama';

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
