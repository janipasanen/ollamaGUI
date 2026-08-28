/**
 * Project config.json provider wiring (#553).
 *
 * Verifies the merge helper that reconciles localStorage-backed connections
 * with config.json providers, and the save helper that persists connection
 * edits back to config.json.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadProjectConfig,
  configProviderToConnection,
  saveProjectConfigFromConnections,
  type ConfigProvider,
} from '../services/projectConfig';
import {
  loadConnections,
  saveConnections,
  addConnection,
  type ModelConnection,
} from '../services/connections';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  // Default: config.json fetch fails (absent). Overridden per test.
  vi.spyOn(globalThis, 'fetch').mockRejectedValue('no-config');
});

// ── configProviderToConnection ────────────────────────────────────────────────

describe('configProviderToConnection (#553)', () => {
  it('maps an ollama provider to an ollama connection', () => {
    const conn = configProviderToConnection({
      id: 'local-ollama', name: 'Local Ollama', type: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    });
    expect(conn).toMatchObject({
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    });
    expect(conn.apiKey).toBeUndefined();
  });

  it('maps a lmstudio provider to an openai connection', () => {
    const conn = configProviderToConnection({
      id: 'lm-studio', name: 'LM Studio', type: 'lmstudio',
      baseUrl: 'http://gx10:1234', enabled: true, apiKey: 'k',
    });
    expect(conn.kind).toBe('openai');
    expect(conn.apiKey).toBe('k');
  });

  it('defaults enabled to true when omitted', () => {
    const conn = configProviderToConnection({
      id: 'x', name: 'X', type: 'ollama', baseUrl: 'http://x',
    });
    expect(conn.enabled).toBe(true);
  });

  it('passes through a provider-declared default model (#553)', () => {
    const conn = configProviderToConnection({
      id: 'lm-studio', name: 'LM Studio', type: 'lmstudio',
      baseUrl: 'http://gx10:1234', enabled: true,
      defaultModel: 'north-mini-code-1.0:q8_0',
    });
    expect(conn.defaultModel).toBe('north-mini-code-1.0:q8_0');
  });
});

// ── saveProjectConfigFromConnections ────────────────────────────────────────────

const cfg = {
  version: 1,
  providers: [
    { id: 'local-ollama', name: 'Local Ollama', type: 'ollama' as const, baseUrl: 'http://localhost:11434', enabled: true, defaultModel: 'qwen3-coder:q8_0' },
    { id: 'lm-studio', name: 'LM Studio', type: 'lmstudio' as const, baseUrl: 'http://gx10:1234', enabled: true, apiKey: 'abc', defaultModel: 'north-mini:q8_0' },
  ],
};

describe('saveProjectConfigFromConnections (#553)', () => {
  const resp = (ok: boolean, body = '') => new Response(body, {
    status: ok ? 200 : 404,
    statusText: ok ? 'OK' : 'Not Found',
  });

  it('writes connections to config.json when it already exists', async () => {
    let posts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      const isPost = !!(opts as any)?.method;
      if (!isPost) return resp(true, JSON.stringify(cfg)); // loader GET
      posts++; // POST
      return resp(true);
    });

    const conns: ModelConnection[] = [
      { id: 'local-ollama', name: 'Local Ollama (edited)', kind: 'ollama', baseUrl: 'http://localhost:11434', apiKey: 'k1', enabled: true },
      { id: 'lm-studio', name: 'LM Studio', kind: 'openai', baseUrl: 'http://gx10:1234', apiKey: 'k2', enabled: false },
    ];

    const ok = await saveProjectConfigFromConnections(conns);
    expect(ok).toBe(true);
    expect(posts).toBe(1);
  });

  it('returns false and writes nothing when config.json is absent', async () => {
    let posts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      const isPost = !!(opts as any)?.method;
      if (!isPost) return resp(false); // loader sees it's missing
      posts++;
      return resp(true);
    });

    const ok = await saveProjectConfigFromConnections([{
      id: 'x', name: 'X', kind: 'ollama', baseUrl: 'http://x', enabled: true,
    }]);
    expect(ok).toBe(false);
    expect(posts).toBe(0);
  });

  it('preserves a config.json defaultModel that is not stored on the connection', async () => {
    let postedBody = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      const isPost = !!(opts as any)?.method;
      if (!isPost) return resp(true, JSON.stringify(cfg)); // loader GET
      postedBody = (opts as any).body; // POST
      return resp(true);
    });

    const conns: ModelConnection[] = [
      { id: 'local-ollama', name: 'Local Ollama', kind: 'ollama', baseUrl: 'http://localhost:11434', enabled: true },
      { id: 'lm-studio', name: 'LM Studio', kind: 'openai', baseUrl: 'http://gx10:1234', enabled: true },
    ];

    await saveProjectConfigFromConnections(conns);
    const posted = JSON.parse(postedBody);
    expect(posted.providers[0].defaultModel).toBe('qwen3-coder:q8_0');
    expect(posted.providers[1].defaultModel).toBe('north-mini:q8_0');
  });
});
