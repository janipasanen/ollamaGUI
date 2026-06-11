import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyMlxHierarchy, loadMlxSettings, saveMlxSettings, isMlxActive,
  checkMlxAvailable, fetchMlxChatStream, DEFAULT_MLX_SETTINGS,
  MlxAvailability, MlxSettings,
} from '../services/mlx';

const AVAILABLE: MlxAvailability = {
  available: true, apple_silicon: true, mlx_lm: true,
  python: 'python3', version: '0.20.0', reason: 'ok',
};
const UNAVAILABLE: MlxAvailability = {
  available: false, apple_silicon: false, mlx_lm: false,
  python: null, version: null, reason: 'no',
};

describe('MLX settings hierarchy', () => {
  it('full inference enables embeddings and detect', () => {
    const s = applyMlxHierarchy({ ...DEFAULT_MLX_SETTINGS, fullInference: true });
    expect(s.accelerateEmbeddings).toBe(true);
    expect(s.detectIndicate).toBe(true);
  });

  it('embeddings enables detect but not full inference', () => {
    const s = applyMlxHierarchy({ ...DEFAULT_MLX_SETTINGS, accelerateEmbeddings: true });
    expect(s.detectIndicate).toBe(true);
    expect(s.fullInference).toBe(false);
  });

  it('detect alone enables nothing above it', () => {
    const s = applyMlxHierarchy({ ...DEFAULT_MLX_SETTINGS, detectIndicate: true });
    expect(s.accelerateEmbeddings).toBe(false);
    expect(s.fullInference).toBe(false);
  });

  it('does not mutate the input', () => {
    const input: MlxSettings = { ...DEFAULT_MLX_SETTINGS, fullInference: true };
    applyMlxHierarchy(input);
    expect(input.accelerateEmbeddings).toBe(false);
  });
});

describe('MLX settings persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns defaults when nothing stored', () => {
    expect(loadMlxSettings()).toEqual(DEFAULT_MLX_SETTINGS);
  });

  it('round-trips and enforces hierarchy on load', () => {
    saveMlxSettings({ ...DEFAULT_MLX_SETTINGS, fullInference: true, localModel: 'mlx-community/X' });
    const loaded = loadMlxSettings();
    expect(loaded.fullInference).toBe(true);
    expect(loaded.accelerateEmbeddings).toBe(true);
    expect(loaded.detectIndicate).toBe(true);
    expect(loaded.localModel).toBe('mlx-community/X');
  });

  it('merges unknown/partial stored shape with defaults', () => {
    localStorage.setItem('ollama_gui_mlx_settings', JSON.stringify({ fullInference: true }));
    const loaded = loadMlxSettings();
    expect(loaded.serverPort).toBe(DEFAULT_MLX_SETTINGS.serverPort);
    expect(loaded.accelerateEmbeddings).toBe(true);
  });

  it('tolerates corrupt JSON', () => {
    localStorage.setItem('ollama_gui_mlx_settings', '{not json');
    expect(loadMlxSettings()).toEqual(DEFAULT_MLX_SETTINGS);
  });
});

describe('isMlxActive', () => {
  it('true only when available AND full inference on', () => {
    expect(isMlxActive({ ...DEFAULT_MLX_SETTINGS, fullInference: true }, AVAILABLE)).toBe(true);
    expect(isMlxActive({ ...DEFAULT_MLX_SETTINGS, fullInference: true }, UNAVAILABLE)).toBe(false);
    expect(isMlxActive({ ...DEFAULT_MLX_SETTINGS, fullInference: false }, AVAILABLE)).toBe(false);
  });
});

describe('checkMlxAvailable', () => {
  it('returns an unavailable result when Tauri is absent (no throw)', async () => {
    const result = await checkMlxAvailable();
    expect(result.available).toBe(false);
    expect(typeof result.reason).toBe('string');
  });
});

describe('fetchMlxChatStream', () => {
  beforeEach(() => vi.restoreAllMocks());

  function sseBody(lines: string[]) {
    const encoder = new TextEncoder();
    let i = 0;
    return {
      getReader: () => ({
        read: vi.fn().mockImplementation(() => {
          if (i < lines.length) {
            const chunk = encoder.encode(lines[i] + '\n');
            i++;
            return Promise.resolve({ done: false, value: chunk });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      }),
    };
  }

  it('accumulates content deltas from SSE frames', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: sseBody([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        'data: [DONE]',
      ]),
    });

    const out: string[] = [];
    await fetchMlxChatStream('m', [{ role: 'user', content: 'hi' }], (d) => out.push(d), 8080);
    expect(out.join('')).toBe('Hello');
  });

  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'down', body: null });
    await expect(
      fetchMlxChatStream('m', [{ role: 'user', content: 'hi' }], () => {}, 8080),
    ).rejects.toThrow(/MLX server error/);
  });

  it('only sends role/content (strips tool/image fields)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: sseBody(['data: [DONE]']) });
    global.fetch = fetchMock;
    await fetchMlxChatStream(
      'm',
      [{ role: 'user', content: 'hi', images: ['x'], tool_calls: [{}] } as any],
      () => {},
      9000,
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hi' });
    expect(fetchMock.mock.calls[0][0]).toContain(':9000');
  });
});
