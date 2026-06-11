import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadImageGenConfig, saveImageGenConfig,
  generateA1111, generateOpenAI, generateImage,
  type ImageGenConfig,
} from '../services/imagegen';

// Force Tauri to be unavailable so httpRequest falls back to fetch
vi.mock('@tauri-apps/api/core', () => {
  return { invoke: vi.fn(() => { throw new Error('tauri unavailable in test'); }) };
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ── Persistence ───────────────────────────────────────────────────────────────

describe('loadImageGenConfig / saveImageGenConfig (#130)', () => {
  it('returns defaults when nothing is stored', () => {
    const cfg = loadImageGenConfig();
    expect(cfg.backend).toBe('a1111');
    expect(cfg.enabled).toBe(false);
    expect(cfg.baseUrl).toBe('http://127.0.0.1:7860');
  });

  it('round-trips config through localStorage', () => {
    const cfg: ImageGenConfig = { backend: 'comfyui', baseUrl: 'http://localhost:8188', steps: 30, size: '768x768', enabled: true };
    saveImageGenConfig(cfg);
    expect(loadImageGenConfig()).toEqual(cfg);
  });

  it('merges stored values with defaults', () => {
    localStorage.setItem('imagegen_config', JSON.stringify({ backend: 'openai', enabled: true, apiKey: 'sk-test' }));
    const cfg = loadImageGenConfig();
    expect(cfg.backend).toBe('openai');
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiKey).toBe('sk-test');
    // Defaults still present
    expect(cfg.steps).toBe(20);
  });
});

// ── A1111 backend ─────────────────────────────────────────────────────────────

describe('generateA1111 (#130)', () => {
  const cfg: ImageGenConfig = { backend: 'a1111', baseUrl: 'http://127.0.0.1:7860', steps: 20, size: '512x512', enabled: true };

  it('posts to /sdapi/v1/txt2img and returns base64 images', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify({ images: ['base64abc', 'base64def'] }),
    } as any);
    const results = await generateA1111(cfg, { prompt: 'a cat' });
    expect(results).toHaveLength(2);
    expect(results[0].image).toBe('base64abc');
    expect(results[0].mimeType).toBe('image/png');
    expect(results[0].prompt).toBe('a cat');
  });

  it('sends prompt, negative_prompt, steps, width, height in request body', async () => {
    let body = '';
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, opts) => {
      body = opts!.body as string;
      return { status: 200, text: async () => JSON.stringify({ images: [] }) } as any;
    });
    await generateA1111(cfg, { prompt: 'a dog', negativePrompt: 'blurry', steps: 30, size: '768x768' });
    const parsed = JSON.parse(body);
    expect(parsed.prompt).toBe('a dog');
    expect(parsed.negative_prompt).toBe('blurry');
    expect(parsed.steps).toBe(30);
    expect(parsed.width).toBe(768);
    expect(parsed.height).toBe(768);
  });

  it('strips trailing slash from baseUrl', async () => {
    let calledUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url) => {
      calledUrl = url as string;
      return { status: 200, text: async () => JSON.stringify({ images: [] }) } as any;
    });
    await generateA1111({ ...cfg, baseUrl: 'http://127.0.0.1:7860/' }, { prompt: 'x' });
    expect(calledUrl).toBe('http://127.0.0.1:7860/sdapi/v1/txt2img');
  });

  it('injects Basic auth header when apiKey is set', async () => {
    let headers: any = {};
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, opts) => {
      headers = opts!.headers;
      return { status: 200, text: async () => JSON.stringify({ images: [] }) } as any;
    });
    await generateA1111({ ...cfg, apiKey: 'password' }, { prompt: 'x' });
    expect(headers['Authorization']).toMatch(/^Basic /);
  });

  it('throws on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 500, text: async () => 'Internal Server Error',
    } as any);
    await expect(generateA1111(cfg, { prompt: 'x' })).rejects.toThrow('A1111 error 500');
  });

  it('includes model in override_settings when specified', async () => {
    let body = '';
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, opts) => {
      body = opts!.body as string;
      return { status: 200, text: async () => JSON.stringify({ images: [] }) } as any;
    });
    await generateA1111(cfg, { prompt: 'x', model: 'dreamshaper_v8' });
    const parsed = JSON.parse(body);
    expect(parsed.override_settings?.sd_model_checkpoint).toBe('dreamshaper_v8');
  });
});

// ── OpenAI DALL-E backend ─────────────────────────────────────────────────────

describe('generateOpenAI (#130)', () => {
  const cfg: ImageGenConfig = { backend: 'openai', baseUrl: '', apiKey: 'sk-test', enabled: true, size: '1024x1024' };

  it('posts to OpenAI images/generations and returns b64_json images', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 200, text: async () => JSON.stringify({ data: [{ b64_json: 'imgdata1' }, { b64_json: 'imgdata2' }] }),
    } as any);
    const results = await generateOpenAI(cfg, { prompt: 'a landscape' });
    expect(results).toHaveLength(2);
    expect(results[0].image).toBe('imgdata1');
    expect(results[0].prompt).toBe('a landscape');
  });

  it('sends Authorization Bearer header', async () => {
    let headers: any = {};
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, opts) => {
      headers = opts!.headers;
      return { status: 200, text: async () => JSON.stringify({ data: [] }) } as any;
    });
    await generateOpenAI(cfg, { prompt: 'x' });
    expect(headers['Authorization']).toBe('Bearer sk-test');
  });

  it('throws when no apiKey', async () => {
    await expect(generateOpenAI({ ...cfg, apiKey: undefined }, { prompt: 'x' })).rejects.toThrow('requires an API key');
  });

  it('throws on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 401, text: async () => 'Unauthorized',
    } as any);
    await expect(generateOpenAI(cfg, { prompt: 'x' })).rejects.toThrow('DALL-E error 401');
  });
});

// ── Unified generateImage ─────────────────────────────────────────────────────

describe('generateImage (#130)', () => {
  it('throws when config.enabled is false', async () => {
    const cfg: ImageGenConfig = { backend: 'a1111', baseUrl: 'http://x', enabled: false };
    await expect(generateImage({ prompt: 'x' }, cfg)).rejects.toThrow('disabled');
  });

  it('routes to a1111 when backend is a1111', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 200, text: async () => JSON.stringify({ images: ['pic'] }),
    } as any);
    const cfg: ImageGenConfig = { backend: 'a1111', baseUrl: 'http://127.0.0.1:7860', enabled: true };
    const results = await generateImage({ prompt: 'a sunset' }, cfg);
    expect(results[0].image).toBe('pic');
  });

  it('routes to openai when backend is openai', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 200, text: async () => JSON.stringify({ data: [{ b64_json: 'openai-img' }] }),
    } as any);
    const cfg: ImageGenConfig = { backend: 'openai', baseUrl: '', apiKey: 'sk-x', enabled: true };
    const results = await generateImage({ prompt: 'x' }, cfg);
    expect(results[0].image).toBe('openai-img');
  });

  it('throws for unknown backend', async () => {
    const cfg = { backend: 'unknown' as any, baseUrl: '', enabled: true };
    await expect(generateImage({ prompt: 'x' }, cfg)).rejects.toThrow('Unknown image generation backend');
  });
});
