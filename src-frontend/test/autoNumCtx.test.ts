import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const KEY = 'model_context_config_v1';
const GB = 1024 ** 3;
const NO_CAPS = { contextLength: null, tools: null };

// The memoized per-module config cache in `loadContextConfigs()` is keyed by
// connection/model and survives across tests. Reset the module registry so the
// next dynamic import re-runs module init and clears that cache.
const load = async () => {
  vi.resetModules();
  const mod = await import('../services/ollama');
  return mod;
};

function ramConfig(window: number) {
  return JSON.stringify({
    'local-ollama/llama3': { contextWindow: window, compactionThreshold: 0.8, autoDetected: false },
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});
afterEach(() => localStorage.clear());

describe('autoNumCtx — non-agentic RAM budget (capped at 8192)', () => {
  it('returns 4096 for a 4 GB machine', async () => {
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 4 * GB, false)).toBe(4096);
  });

  it('returns 8192 for an 8 GB machine', async () => {
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 8 * GB, false)).toBe(8192);
  });

  it('caps at 8192 for a 16 GB machine (non-agentic)', async () => {
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 16 * GB, false)).toBe(8192);
  });

  it('caps at 8192 for a 24 GB machine (non-agentic)', async () => {
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 24 * GB, false)).toBe(8192);
  });

  it('falls back to the 8 GB budget when totalRamBytes is null', async () => {
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, null, false)).toBe(8192);
  });
});

describe('autoNumCtx — agentic full RAM budget', () => {
  it('caps at 8192 for an 8 GB agentic run', async () => {
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 8 * GB, true)).toBe(8192);
  });

  it('returns 16384 for a 16 GB agentic run', async () => {
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 16 * GB, true)).toBe(16384);
  });

  it('returns 32768 for a 24 GB agentic run', async () => {
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 24 * GB, true)).toBe(32768);
  });

  it('lets agentic runs exceed the non-agentic 8192 cap on 16 GB', async () => {
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 16 * GB, true)).toBeGreaterThan(8192);
  });
});

describe('autoNumCtx — built-in context limit', () => {
  it('honours a built-in context length regardless of RAM (ignores budget)', async () => {
    const { autoNumCtx } = await load();
    const caps = { contextLength: 262144, tools: null, contextSource: 'built-in' as const };
    // A 4 GB box still gets the true server-controlled window.
    expect(autoNumCtx(caps, 4 * GB, false)).toBe(262144);
  });

  it('clamps a built-in limit to the 4096 floor', async () => {
    const { autoNumCtx } = await load();
    const caps = { contextLength: 2048, tools: null, contextSource: 'built-in' as const };
    expect(autoNumCtx(caps, 16 * GB, false)).toBe(4096);
  });
});

describe('autoNumCtx — native (server-reported) context limit', () => {
  it('prefers native limit over RAM, then caps to the agentic budget', async () => {
    const { autoNumCtx } = await load();
    const caps = { contextLength: 100000, tools: null, contextSource: 'server' as const };
    expect(autoNumCtx(caps, 16 * GB, true)).toBe(16384);
  });

  it('native limit is still capped by the non-agentic budget', async () => {
    const { autoNumCtx } = await load();
    const caps = { contextLength: 100000, tools: null, contextSource: 'server' as const };
    expect(autoNumCtx(caps, 16 * GB, false)).toBe(8192);
  });
});

describe('autoNumCtx — user-configured context window', () => {
  it('prefers the configured window when it fits within the RAM budget', async () => {
    localStorage.setItem(KEY, ramConfig(8192));
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 16 * GB, false, 'local-ollama', 'llama3')).toBe(8192);
  });

  it('raises a configured window below the 4096 floor up to 4096', async () => {
    localStorage.setItem(KEY, ramConfig(2048));
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 16 * GB, false, 'local-ollama', 'llama3')).toBe(4096);
  });

  it('clamps a configured window above the RAM budget down to the budget', async () => {
    // Agentic run on 24 GB → budget 32768; the huge configured window is
    // clamped down to that (not returned verbatim).
    localStorage.setItem(KEY, ramConfig(131072));
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 24 * GB, true, 'local-ollama', 'llama3')).toBe(32768);
  });

  it('caps a huge configured window to the non-agentic 8192 ceiling', async () => {
    localStorage.setItem(KEY, ramConfig(131072));
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 8 * GB, false, 'local-ollama', 'llama3')).toBe(8192);
  });

  it('lets the user-config window win over a native limit', async () => {
    localStorage.setItem(KEY, ramConfig(8192));
    const { autoNumCtx } = await load();
    const caps = { contextLength: 100000, tools: null, contextSource: 'server' as const };
    expect(autoNumCtx(caps, 16 * GB, false, 'local-ollama', 'llama3')).toBe(8192);
  });

  it('skips user config entirely when connection/model are absent', async () => {
    localStorage.setItem(KEY, ramConfig(8192));
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 16 * GB, false)).toBe(8192);
  });
});

describe('autoNumCtx — resilience', () => {
  it('does not throw on corrupt localStorage and falls back to the RAM budget', async () => {
    localStorage.setItem(KEY, '{ not valid json');
    const { autoNumCtx } = await load();
    expect(autoNumCtx(NO_CAPS, 16 * GB, false, 'local-ollama', 'llama3')).toBe(8192);
  });
});
