/**
 * Local image generation (#130): A1111 / ComfyUI / OpenAI DALL-E backends.
 * HTTP calls route through Rust mcp_http_request to avoid CORS.
 * Generated images are base64-encoded PNGs ready for the existing image path.
 */
const STORAGE_KEY = 'imagegen_config';

export type ImageGenBackend = 'a1111' | 'comfyui' | 'openai';

export interface ImageGenConfig {
  backend: ImageGenBackend;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  steps?: number;
  size?: string;    // e.g. '512x512', '1024x1024'
  enabled: boolean;
}

export interface ImageGenRequest {
  prompt: string;
  negativePrompt?: string;
  steps?: number;
  size?: string;
  model?: string;
  n?: number;
}

export interface ImageGenResult {
  /** Base64-encoded PNG/JPEG, no data-URL prefix */
  image: string;
  mimeType: 'image/png' | 'image/jpeg';
  /** Prompt that produced this image */
  prompt: string;
}

const DEFAULT_CONFIG: ImageGenConfig = {
  backend: 'a1111',
  baseUrl: 'http://127.0.0.1:7860',
  steps: 20,
  size: '512x512',
  enabled: false,
};

// ── Persistence ───────────────────────────────────────────────────────────────

export function loadImageGenConfig(): ImageGenConfig {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }; } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveImageGenConfig(cfg: ImageGenConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

/** Make an HTTP request, routing through Rust to avoid CORS. Falls back to fetch. */
async function httpRequest(
  method: string,
  url: string,
  body?: string,
  headers?: Record<string, string>
): Promise<{ status: number; body: string }> {
  const hdrs = { 'Content-Type': 'application/json', ...headers };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const res = await invoke('mcp_http_request', {
      request: { method, url, headers: hdrs, body },
    }) as { success: boolean; status: number; body: string };
    return { status: res.status, body: res.body };
  } catch {
    const res = await fetch(url, { method, headers: hdrs, body });
    return { status: res.status, body: await res.text() };
  }
}

// ── A1111 backend ─────────────────────────────────────────────────────────────

export async function generateA1111(cfg: ImageGenConfig, req: ImageGenRequest): Promise<ImageGenResult[]> {
  const [width, height] = (req.size ?? cfg.size ?? '512x512').split('x').map(Number);
  const payload: Record<string, any> = {
    prompt: req.prompt,
    negative_prompt: req.negativePrompt ?? '',
    steps: req.steps ?? cfg.steps ?? 20,
    width: width ?? 512,
    height: height ?? 512,
    n_iter: req.n ?? 1,
    batch_size: 1,
  };
  if (req.model ?? cfg.defaultModel) payload.override_settings = { sd_model_checkpoint: req.model ?? cfg.defaultModel };

  const hdrs: Record<string, string> = {};
  if (cfg.apiKey) hdrs['Authorization'] = `Basic ${btoa(`:${cfg.apiKey}`)}`;

  const resp = await httpRequest('POST', `${cfg.baseUrl.replace(/\/$/, '')}/sdapi/v1/txt2img`, JSON.stringify(payload), hdrs);
  if (resp.status < 200 || resp.status >= 300) throw new Error(`A1111 error ${resp.status}: ${resp.body.slice(0, 200)}`);

  const data = JSON.parse(resp.body) as { images?: string[] };
  return (data.images ?? []).map(b64 => ({ image: b64, mimeType: 'image/png', prompt: req.prompt }));
}

// ── ComfyUI backend ───────────────────────────────────────────────────────────

/** Minimal text-to-image ComfyUI workflow template */
function buildComfyWorkflow(req: ImageGenRequest, cfg: ImageGenConfig): Record<string, any> {
  const [width, height] = (req.size ?? cfg.size ?? '512x512').split('x').map(Number);
  return {
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: req.prompt } },
    '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: req.negativePrompt ?? '' } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: req.model ?? cfg.defaultModel ?? 'v1-5-pruned.ckpt' } },
    '3': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], steps: req.steps ?? cfg.steps ?? 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: width ?? 512, height: height ?? 512, batch_size: 1 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'ollamagui' } },
  };
}

export async function generateComfyUI(cfg: ImageGenConfig, req: ImageGenRequest): Promise<ImageGenResult[]> {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const workflow = buildComfyWorkflow(req, cfg);

  // Queue the prompt
  const queueResp = await httpRequest('POST', `${base}/prompt`, JSON.stringify({ prompt: workflow }));
  if (queueResp.status < 200 || queueResp.status >= 300) throw new Error(`ComfyUI queue error ${queueResp.status}`);
  const { prompt_id } = JSON.parse(queueResp.body) as { prompt_id: string };

  // Poll history until complete (max 60s)
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    await new Promise(r => setTimeout(r, 1000));
    const histResp = await httpRequest('GET', `${base}/history/${prompt_id}`);
    if (histResp.status !== 200) continue;
    const hist = JSON.parse(histResp.body) as Record<string, any>;
    const entry = hist[prompt_id];
    if (!entry?.outputs) continue;

    const images: ImageGenResult[] = [];
    for (const node of Object.values(entry.outputs as Record<string, any>)) {
      for (const img of (node as any).images ?? []) {
        const imgResp = await httpRequest('GET', `${base}/view?filename=${img.filename}&subfolder=${img.subfolder ?? ''}&type=${img.type ?? 'output'}`);
        if (imgResp.status === 200) {
          images.push({ image: btoa(imgResp.body), mimeType: 'image/png', prompt: req.prompt });
        }
      }
    }
    if (images.length) return images;
  }
  throw new Error('ComfyUI timed out waiting for image');
}

// ── OpenAI DALL-E backend ─────────────────────────────────────────────────────

export async function generateOpenAI(cfg: ImageGenConfig, req: ImageGenRequest): Promise<ImageGenResult[]> {
  if (!cfg.apiKey) throw new Error('OpenAI image generation requires an API key');
  const size = req.size ?? cfg.size ?? '1024x1024';
  const payload = {
    prompt: req.prompt,
    n: req.n ?? 1,
    size,
    response_format: 'b64_json',
    model: req.model ?? cfg.defaultModel ?? 'dall-e-3',
  };
  const resp = await httpRequest('POST', 'https://api.openai.com/v1/images/generations', JSON.stringify(payload), {
    Authorization: `Bearer ${cfg.apiKey}`,
  });
  if (resp.status < 200 || resp.status >= 300) throw new Error(`DALL-E error ${resp.status}: ${resp.body.slice(0, 200)}`);
  const data = JSON.parse(resp.body) as { data?: { b64_json: string }[] };
  return (data.data ?? []).map(d => ({ image: d.b64_json, mimeType: 'image/png', prompt: req.prompt }));
}

// ── Unified entry point ────────────────────────────────────────────────────────

/** Generate images using the configured backend */
export async function generateImage(req: ImageGenRequest, cfg?: ImageGenConfig): Promise<ImageGenResult[]> {
  const config = cfg ?? loadImageGenConfig();
  if (!config.enabled) throw new Error('Image generation is disabled — enable it in Settings');
  switch (config.backend) {
    case 'a1111': return generateA1111(config, req);
    case 'comfyui': return generateComfyUI(config, req);
    case 'openai': return generateOpenAI(config, req);
    default: throw new Error(`Unknown image generation backend: ${config.backend}`);
  }
}

/** Register a generate_image tool into the tool registry */
export function registerImageGenTool(cfg: () => ImageGenConfig): void {
  // Lazy import to avoid circular — toolRegistry is in tools.ts
  import('./tools').then(({ toolRegistry }) => {
    toolRegistry.registerTool({
      name: 'generate_image',
      description: 'Generate an image from a text prompt using the configured local or cloud image generation backend.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The image generation prompt' },
          negative_prompt: { type: 'string', description: 'Negative prompt (what to avoid)' },
          size: { type: 'string', description: 'Image size, e.g. 512x512 or 1024x1024' },
          steps: { type: 'string', description: 'Number of diffusion steps (e.g. 20)' },
        },
        required: ['prompt'],
      } as any,
      execute: async (params) => {
        const config = cfg();
        const results = await generateImage({
          prompt: params.prompt,
          negativePrompt: params.negative_prompt,
          size: params.size,
          steps: params.steps ? parseInt(params.steps) : undefined,
        }, config);
        return { images: results.map(r => ({ prompt: r.prompt, base64: r.image })) };
      },
    });
  });
}
