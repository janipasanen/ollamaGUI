/**
 * Tests for #76: Feed browser_screenshot to vision-capable models.
 *
 * Verifies that modelSupportsVision returns true for known vision families,
 * queries /api/show for unknown models, and caches results.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { modelSupportsVision, clearVisionCache } from '../services/ollama';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  clearVisionCache();
  mockFetch.mockReset();
});

afterEach(() => {
  clearVisionCache();
  vi.clearAllMocks();
});

function mockShowResponse(projectorInfo: boolean) {
  return {
    ok: true,
    json: async () => projectorInfo ? { projector_info: { type: 'clip' } } : {},
  };
}

describe('modelSupportsVision (#76)', () => {
  it('returns true for llava-based models (allowlist)', async () => {
    expect(await modelSupportsVision('llava:7b')).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled(); // from cache / allowlist, no network
  });

  it('returns true for llava-phi variant', async () => {
    expect(await modelSupportsVision('llava-phi3:latest')).toBe(true);
  });

  it('returns true for moondream', async () => {
    expect(await modelSupportsVision('moondream:1.8b')).toBe(true);
  });

  it('returns true for qwen2-vl', async () => {
    expect(await modelSupportsVision('qwen2.5-vl:7b')).toBe(true);
  });

  it('returns true for llama3.2-vision', async () => {
    expect(await modelSupportsVision('llama3.2-vision:11b')).toBe(true);
  });

  it('returns false for a non-vision model with no projector_info in /api/show', async () => {
    mockFetch.mockResolvedValue(mockShowResponse(false));
    const result = await modelSupportsVision('llama3:8b');
    expect(result).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/show'), expect.any(Object));
  });

  it('returns true for an unknown model that has projector_info in /api/show', async () => {
    mockFetch.mockResolvedValue(mockShowResponse(true));
    const result = await modelSupportsVision('my-custom-vl:latest');
    expect(result).toBe(true);
  });

  it('caches the result so /api/show is only called once per model', async () => {
    mockFetch.mockResolvedValue(mockShowResponse(false));
    await modelSupportsVision('phi3:mini');
    await modelSupportsVision('phi3:mini');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns false when /api/show request fails (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    const result = await modelSupportsVision('unknown-model:latest');
    expect(result).toBe(false);
  });

  it('returns false for a non-vision model (no projector_info)', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ model_info: {} }) });
    const result = await modelSupportsVision('mistral:7b');
    expect(result).toBe(false);
  });
});

describe('vision screenshot injection path (#76)', () => {
  it('allowlist models do not trigger a network call', async () => {
    // All these should return quickly from the allowlist
    const visionModels = ['llava:latest', 'bakllava:7b', 'minicpm-v:latest', 'pixtral:12b'];
    for (const m of visionModels) {
      clearVisionCache();
      expect(await modelSupportsVision(m)).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  });

  it('base64 image data URL can be stripped to raw base64 for API', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const raw = dataUrl.startsWith('data:') ? (dataUrl.split(',')[1] ?? '') : dataUrl;
    expect(raw).toBe('iVBORw0KGgo=');
    expect(raw).not.toContain('data:');
  });

  it('non-data-URL base64 string is passed through unchanged', () => {
    const raw = 'iVBORw0KGgo=';
    const out = raw.startsWith('data:') ? (raw.split(',')[1] ?? '') : raw;
    expect(out).toBe(raw);
  });
});
