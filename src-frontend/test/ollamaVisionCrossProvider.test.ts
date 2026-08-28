/**
 * G7 — cross-provider vision capability detection.
 *
 * Verifies that modelSupportsVisionForConnection routes by connection kind:
 * Ollama reuses the /api/show + family-allowlist logic, and OpenAI-compatible
 * endpoints are probed via /v1/models. Never throws on failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  modelSupportsVision,
  modelSupportsVisionForConnection,
  clearVisionCache,
} from '../services/ollama';
import type { ModelConnection } from '../services/connections';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function clearCache() {
  clearVisionCache();
  mockFetch.mockClear();
}

beforeEach(clearCache);
afterEach(clearCache);

const ollamaConn: ModelConnection = {
  id: 'local-ollama',
  name: 'Local Ollama',
  kind: 'ollama',
  baseUrl: 'http://localhost:11434',
  enabled: true,
};

const openaiConn: ModelConnection = {
  id: 'lm-studio',
  name: 'LM Studio',
  kind: 'openai',
  baseUrl: 'http://localhost:1234',
  apiKey: 'secret',
  enabled: true,
};

describe('modelSupportsVisionForConnection — ollama kind', () => {
  it('returns true for a vision family without hitting /api/show', async () => {
    const result = await modelSupportsVisionForConnection(
      'llama3.2-vision',
      ollamaConn,
    );
    expect(result).toBe(true);
    // Allowlist short-circuits the network entirely.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('queries /api/show for unknown Ollama models', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ projector_info: { type: 'clip' } }),
    });
    const result = await modelSupportsVisionForConnection('gpt2', ollamaConn);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/api/show');
  });

  it('degrades to false when /api/show fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await modelSupportsVisionForConnection('gpt2', ollamaConn);
    expect(result).toBe(false);
  });

  it('matches the bare modelSupportsVision result for the same model', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ capabilities: ['vision'] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ capabilities: ['vision'] }),
      });
    const viaConn = await modelSupportsVisionForConnection('some-vl-model', ollamaConn);
    const viaFn = await modelSupportsVision('some-vl-model', 'http://localhost:11434');
    expect(viaConn).toBe(viaFn);
    expect(viaFn).toBe(true);
  });
});

describe('modelSupportsVisionForConnection — openai kind', () => {
  it('detects vision via a vision-family id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt2' }, { id: 'qwen2.5-vl' }] }),
    });
    const result = await modelSupportsVisionForConnection('gpt2', openaiConn);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/models');
  });

  it('detects vision via an explicit supports_vision flag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'm1' }, { id: 'm2', supports_vision: true }] }),
    });
    const result = await modelSupportsVisionForConnection('m1', openaiConn);
    expect(result).toBe(true);
  });

  it('detects vision via a capabilities array flag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'm1', capabilities: ['vision'] }] }),
    });
    const result = await modelSupportsVisionForConnection('m1', openaiConn);
    expect(result).toBe(true);
  });

  it('returns false when no listed model is vision-capable', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'qwen3-coder' }, { id: 'llama3.1' }] }),
    });
    const result = await modelSupportsVisionForConnection('llama3.1', openaiConn);
    expect(result).toBe(false);
  });

  it('sends the bearer auth header when an apiKey is set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });
    await modelSupportsVisionForConnection('llama3.1', openaiConn);
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers.Authorization).toBe('Bearer secret');
  });

  it('degrades to false when the model list fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await modelSupportsVisionForConnection('llama3.1', openaiConn);
    expect(result).toBe(false);
  });

  it('never throws on a network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      modelSupportsVisionForConnection('llama3.1', openaiConn),
    ).resolves.toBe(false);
  });
});

describe('modelSupportsVisionForConnection — caching', () => {
  it('caches results and does not re-fetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'llama3.2-vision' }] }),
    });
    await modelSupportsVisionForConnection('llama3.2-vision', openaiConn);
    const second = await modelSupportsVisionForConnection('llama3.2-vision', openaiConn);
    expect(second).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not collide across connection kinds / base URLs', async () => {
    // Two different endpoints; each probe should hit the network.
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'qwen2-vl' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'gpt2' }] }) });
    const a = await modelSupportsVisionForConnection('gpt2', { ...openaiConn, baseUrl: 'http://localhost:1234' });
    const b = await modelSupportsVisionForConnection('gpt2', { ...openaiConn, baseUrl: 'http://localhost:9999' });
    expect(a).toBe(true);
    expect(b).toBe(false);
  });
});
