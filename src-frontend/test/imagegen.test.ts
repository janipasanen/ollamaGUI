import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadImageGenConfig, saveImageGenConfig,
  generateA1111, generateOpenAI, generateImage, generateComfyUI,
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

describe('generateComfyUI — binary image fetch (#130, #431)', () => {
  const cfg: ImageGenConfig = { backend: 'comfyui', baseUrl: 'http://localhost:8188', steps: 20, size: '512x512', enabled: true };

  // PNG signature bytes — btoa(textBody) would throw on these (0x89 etc. are
  // fine Latin1, but a real PNG has bytes that decode to >U+00FF under UTF-8).
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const expectedB64 = 'iVBORw0KGgo=';

  it('fetches the /view image as binary base64 (not btoa(text)) and returns it', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlIn: any) => {
      const url = String(urlIn);
      if (url.endsWith('/prompt')) {
        return { status: 200, text: async () => JSON.stringify({ prompt_id: 'abc' }) } as any;
      }
      if (url.includes('/history/abc')) {
        return {
          status: 200,
          text: async () => JSON.stringify({
            abc: { outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } },
          }),
        } as any;
      }
      if (url.includes('/view')) {
        return { status: 200, blob: async () => new Blob([new Uint8Array(pngSignature)], { type: 'image/png' }) } as any;
      }
      return { status: 404, text: async () => '' } as any;
    });

    const results = await generateComfyUI(cfg, { prompt: 'a cat' });
    expect(results).toHaveLength(1);
    expect(results[0].image).toBe(expectedB64);
    expect(results[0].mimeType).toBe('image/png');
    expect(results[0].prompt).toBe('a cat');
    // The /view endpoint must have been hit.
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/view'))).toBe(true);
  }, 15000);

  it('queues the workflow and polls history until an image appears', async () => {
    let historyCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlIn: any) => {
      const url = String(urlIn);
      if (url.endsWith('/prompt')) {
        return { status: 200, text: async () => JSON.stringify({ prompt_id: 'p1' }) } as any;
      }
      if (url.includes('/history/p1')) {
        historyCalls++;
        if (historyCalls < 2) {
          return { status: 200, text: async () => JSON.stringify({ p1: { outputs: {} } }) } as any;
        }
        return {
          status: 200,
          text: async () => JSON.stringify({
            p1: { outputs: { '9': { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } } },
          }),
        } as any;
      }
      if (url.includes('/view')) {
        return { status: 200, blob: async () => new Blob([new Uint8Array(pngSignature)], { type: 'image/png' }) } as any;
      }
      return { status: 404, text: async () => '' } as any;
    });

    const results = await generateComfyUI(cfg, { prompt: 'a dog' });
    expect(results).toHaveLength(1);
    expect(historyCalls).toBeGreaterThanOrEqual(2);
  }, 20000);

  it('throws on a non-2xx queue response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlIn: any) => {
      const url = String(urlIn);
      if (url.endsWith('/prompt')) return { status: 500, text: async () => 'boom' } as any;
      return { status: 404, text: async () => '' } as any;
    });
    await expect(generateComfyUI(cfg, { prompt: 'x' })).rejects.toThrow(/queue error 500/);
  });
});

// ── #463: non-JSON response bodies must not crash with raw SyntaxError ───────

describe('imagegen malformed-JSON handling (#463)', () => {
  it('generateA1111 throws meaningful error on non-JSON 200 response (#463)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 200, text: async () => '<html>Service Unavailable</html>',
    } as any);
    const cfg: ImageGenConfig = { backend: 'a1111', baseUrl: 'http://127.0.0.1:7860', steps: 20, size: '512x512', enabled: true };
    await expect(generateA1111(cfg, { prompt: 'x' })).rejects.toThrow(/non-JSON response/);
  });

  it('generateOpenAI throws meaningful error on non-JSON 200 response (#463)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 200, text: async () => 'Gateway timeout',
    } as any);
    const cfg: ImageGenConfig = { backend: 'openai', baseUrl: '', apiKey: 'sk-test', enabled: true, size: '1024x1024' };
    await expect(generateOpenAI(cfg, { prompt: 'x' })).rejects.toThrow(/non-JSON response/);
  });

  it('generateComfyUI throws meaningful error on non-JSON queue response (#463)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlIn: any) => {
      const url = String(urlIn);
      if (url.endsWith('/prompt')) return { status: 200, text: async () => 'not json at all' } as any;
      return { status: 404, text: async () => '' } as any;
    });
    const cfg: ImageGenConfig = { backend: 'comfyui', baseUrl: 'http://localhost:8188', steps: 20, size: '512x512', enabled: true };
    await expect(generateComfyUI(cfg, { prompt: 'x' })).rejects.toThrow(/non-JSON queue response/);
  });

  it('generateComfyUI queue error includes body snippet (#463)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlIn: any) => {
      const url = String(urlIn);
      if (url.endsWith('/prompt')) return { status: 400, text: async () => 'invalid workflow: missing CLIPTextEncode' } as any;
      return { status: 404, text: async () => '' } as any;
    });
    const cfg: ImageGenConfig = { backend: 'comfyui', baseUrl: 'http://localhost:8188', steps: 20, size: '512x512', enabled: true };
    await expect(generateComfyUI(cfg, { prompt: 'x' })).rejects.toThrow(/missing CLIPTextEncode/);
  });
});
