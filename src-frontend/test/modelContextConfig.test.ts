import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadModelContextConfigs,
  saveModelContextConfigs,
  getModelContextConfig,
  setModelContextConfig,
  removeModelContextConfig,
  getModelDefaultContext,
  buildModelId,
  getCompactionThreshold,
  detectContextFromApi,
  detectContextWindow,
  type ModelContextConfig,
} from '../services/modelContextConfig';

// STORAGE_KEY is module-local, so use the documented literal here.
const KEY = 'model_context_config_v1';

function cfg(over: Partial<ModelContextConfig> = {}): ModelContextConfig {
  return { contextWindow: 32768, compactionThreshold: 0.8, autoDetected: false, ...over };
}

beforeEach(() => {
  localStorage.clear();
});

describe('saveModelContextConfigs', () => {
  it('writes under the documented localStorage key (round-trips via loadModelContextConfigs)', () => {
    const m = new Map<string, ModelContextConfig>();
    m.set('local-ollama/llama3', cfg());
    saveModelContextConfigs(m);
    expect(localStorage.getItem(KEY)).toBeTruthy();
    expect(loadModelContextConfigs().get('local-ollama/llama3')).toEqual(cfg());
  });
});

describe('loadModelContextConfigs / saveModelContextConfigs', () => {
  it('returns an empty map when nothing is stored', () => {
    expect(loadModelContextConfigs().size).toBe(0);
  });

  it('round-trips configs through localStorage', () => {
    const m = new Map<string, ModelContextConfig>();
    m.set('local-ollama/llama3', cfg({ contextWindow: 131072, autoDetected: true }));
    saveModelContextConfigs(m);
    const loaded = loadModelContextConfigs();
    expect(loaded.get('local-ollama/llama3')).toMatchObject({
      contextWindow: 131072,
      autoDetected: true,
    });
  });

  it('falls back to default threshold when stored value is missing', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'local-ollama/x': { contextWindow: 4096 } }));
    const loaded = loadModelContextConfigs();
    expect(loaded.get('local-ollama/x')).toEqual({
      contextWindow: 4096,
      compactionThreshold: 0.8,
      autoDetected: false,
    });
  });

  it('tolerates corrupt JSON without throwing', () => {
    localStorage.setItem(KEY, '{ not json');
    expect(() => loadModelContextConfigs()).not.toThrow();
    expect(loadModelContextConfigs().size).toBe(0);
  });
});

describe('getModelContextConfig', () => {
  it('returns stored config when present', () => {
    const m = new Map<string, ModelContextConfig>();
    m.set('local-ollama/qwen', cfg({ contextWindow: 8192 }));
    saveModelContextConfigs(m);
    expect(getModelContextConfig('local-ollama/qwen')).toEqual({
      contextWindow: 8192,
      compactionThreshold: 0.8,
      autoDetected: false,
    });
  });

  it('returns the default context window when absent', () => {
    expect(getModelContextConfig('local-ollama/none', 16384)).toEqual({
      contextWindow: 16384,
      compactionThreshold: 0.8,
      autoDetected: false,
    });
  });

  it('uses 32768 as the default when no override is passed', () => {
    expect(getModelContextConfig('local-ollama/none')).toEqual({
      contextWindow: 32768,
      compactionThreshold: 0.8,
      autoDetected: false,
    });
  });
});

describe('setModelContextConfig', () => {
  it('merges a partial config over the existing one and persists', () => {
    setModelContextConfig('local-ollama/x', { contextWindow: 65536 });
    const loaded = loadModelContextConfigs();
    expect(loaded.get('local-ollama/x')).toEqual({
      contextWindow: 65536,
      compactionThreshold: 0.8,
      autoDetected: false,
    });
  });

  it('creates a new entry using default context when none existed', () => {
    setModelContextConfig('local-ollama/new', { contextWindow: 2048, autoDetected: true });
    const loaded = loadModelContextConfigs();
    expect(loaded.get('local-ollama/new')).toEqual({
      contextWindow: 2048,
      compactionThreshold: 0.8,
      autoDetected: true,
    });
  });

  it('preserves autoDetected=false when no config exists', () => {
    setModelContextConfig('local-ollama/persist', { compactionThreshold: 0.7 });
    const stored = loadModelContextConfigs().get('local-ollama/persist');
    expect(stored?.autoDetected).toBe(false);
  });
});

describe('removeModelContextConfig', () => {
  it('deletes an existing entry and persists', () => {
    setModelContextConfig('local-ollama/tmp', { contextWindow: 4096 });
    expect(loadModelContextConfigs().has('local-ollama/tmp')).toBe(true);
    removeModelContextConfig('local-ollama/tmp');
    expect(loadModelContextConfigs().has('local-ollama/tmp')).toBe(false);
  });

  it('is a no-op when the entry does not exist', () => {
    expect(() => removeModelContextConfig('local-ollama/absent')).not.toThrow();
  });
});

describe('getModelDefaultContext', () => {
  it('returns 32768 (~16GB RAM baseline)', () => {
    expect(getModelDefaultContext()).toBe(32768);
  });
});

describe('buildModelId', () => {
  it('joins connection id and model name', () => {
    expect(buildModelId('local-ollama', 'llama3')).toBe('local-ollama/llama3');
  });

  it('strips a pre-existing <connectionId>/ prefix', () => {
    expect(buildModelId('local-ollama', 'local-ollama/llama3')).toBe('local-ollama/llama3');
  });
});

describe('getCompactionThreshold', () => {
  it('multiplies context window by the threshold', () => {
    expect(getCompactionThreshold(cfg({ contextWindow: 8192, compactionThreshold: 0.8 }))).toBe(6553.6);
  });
});

describe('detectContextFromApi (#8 context window)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads Ollama /api/show context_length', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model_info: { file_type: 'gguf', 'llama.context_length': 131072 } }),
    });
    await expect(detectContextFromApi('http://localhost:11434', 'llama3')).resolves.toBe(131072);
  });

  it('reads an OpenAI-compatible /v1/models context_length', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'qwen', context_length: 32768 }] }),
    });
    await expect(detectContextFromApi('http://gx10:1234', 'qwen')).resolves.toBe(32768);
  });

  it('returns null when neither endpoint exposes a context_length', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model_info: {} }) });
    await expect(detectContextFromApi('http://localhost:11434', 'x')).resolves.toBeNull();
  });

  it('returns null when the /api/show request is not ok and /v1/models is missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(detectContextFromApi('http://localhost:11434', 'x')).resolves.toBeNull();
  });

  it('returns null on a thrown fetch error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(detectContextFromApi('http://localhost:11434', 'x')).resolves.toBeNull();
  });
});

// ── detectContextWindow — production entry point for GAP #9 ─────────────────

describe('detectContextWindow (#9 context window tuning)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('detects from /api/show and persists it as autoDetected', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model_info: { 'llama.context_length': 131072 } }),
    });
    const result = await detectContextWindow('http://localhost:11434', 'local-ollama', 'llama3');
    expect(result).toBe(131072);

    const configs = loadModelContextConfigs();
    expect(configs.has('local-ollama/llama3')).toBe(true);
    const entry = configs.get('local-ollama/llama3')!;
    expect(entry.contextWindow).toBe(131072);
    expect(entry.autoDetected).toBe(true);
    // Default compaction threshold applied for a newly-detected model.
    expect(entry.compactionThreshold).toBe(0.8);
  });

  it('detects from an OpenAI-compatible /v1/models endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'qwen', context_length: 32768 }] }),
    });
    const result = await detectContextWindow('http://gx10:1234', 'lm-studio', 'qwen');
    expect(result).toBe(32768);
    expect(loadModelContextConfigs().get('lm-studio/qwen')?.contextWindow).toBe(32768);
  });

  it('does not persist when the server exposes no context limit', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model_info: {} }) });
    const result = await detectContextWindow('http://localhost:11434', 'local-ollama', 'llama3');
    expect(result).toBeNull();
    expect(loadModelContextConfigs().has('local-ollama/llama3')).toBe(false);
  });

  it('does not persist or throw on a thrown fetch error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await detectContextWindow('http://localhost:11434', 'local-ollama', 'llama3');
    expect(result).toBeNull();
    expect(loadModelContextConfigs().has('local-ollama/llama3')).toBe(false);
  });

  it('does not persist negative / non-finite detections', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model_info: { 'llama.context_length': -100 } }),
    });
    const result = await detectContextWindow('http://localhost:11434', 'local-ollama', 'llama3');
    expect(result).toBeNull();
  });
});
