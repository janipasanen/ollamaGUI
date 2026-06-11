import { describe, it, expect, vi } from 'vitest';
import {
  hasSameHostConflict, groupByHost, runManyModels,
  type ModelReply,
} from '../services/manyModels';
import type { ModelConnection, ConnectedModel } from '../services/connections';

const DEFAULT_URL = 'http://localhost:11434';

// Fixtures
const localA: ConnectedModel = { id: 'loc/llama3', name: 'llama3:8b', connectionId: 'loc', connectionName: 'Local Ollama', kind: 'ollama' };
const localB: ConnectedModel = { id: 'loc/mistral', name: 'mistral:7b', connectionId: 'loc', connectionName: 'Local Ollama', kind: 'ollama' };
const remoteC: ConnectedModel = { id: 'rem/gpt4', name: 'gpt-4', connectionId: 'rem', connectionName: 'Remote', kind: 'openai' };

const connLoc: ModelConnection = { id: 'loc', name: 'Local Ollama', kind: 'ollama', baseUrl: 'http://localhost:11434', enabled: true };
const connRem: ModelConnection = { id: 'rem', name: 'Remote', kind: 'openai', baseUrl: 'http://api.example.com', enabled: true };

// ── hasSameHostConflict ───────────────────────────────────────────────────────

describe('hasSameHostConflict (#126)', () => {
  it('detects two models on the same local Ollama host', () => {
    expect(hasSameHostConflict(['loc/llama3', 'loc/mistral'], DEFAULT_URL, [localA, localB], [connLoc])).toBe(true);
  });

  it('no conflict when models are on different hosts', () => {
    expect(hasSameHostConflict(['loc/llama3', 'rem/gpt4'], DEFAULT_URL, [localA, remoteC], [connLoc, connRem])).toBe(false);
  });

  it('detects conflict for two models using the default Ollama host', () => {
    // Models not in connectedModels default to the main Ollama host
    expect(hasSameHostConflict(['ministral-3:3b', 'llama3.2:1b'], DEFAULT_URL, [], [])).toBe(true);
  });

  it('single model never conflicts', () => {
    expect(hasSameHostConflict(['ministral-3:3b'], DEFAULT_URL, [], [])).toBe(false);
  });
});

// ── groupByHost ───────────────────────────────────────────────────────────────

describe('groupByHost (#126)', () => {
  it('groups two same-host models into one batch', () => {
    const groups = groupByHost(['loc/llama3', 'loc/mistral'], DEFAULT_URL, [localA, localB], [connLoc]);
    expect(groups).toHaveLength(1);
    expect(groups[0].models).toHaveLength(2);
  });

  it('puts different-host models in separate batches', () => {
    const groups = groupByHost(['loc/llama3', 'rem/gpt4'], DEFAULT_URL, [localA, remoteC], [connLoc, connRem]);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.host)).toContain('http://localhost:11434');
    expect(groups.map(g => g.host)).toContain('http://api.example.com');
  });

  it('unknown models fall back to defaultBaseUrl', () => {
    const groups = groupByHost(['ministral-3:3b', 'llama3.2:1b'], DEFAULT_URL, [], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].host).toBe(DEFAULT_URL);
    expect(groups[0].models).toHaveLength(2);
  });
});

// ── runManyModels — sequential on same host ────────────────────────────────────

describe('runManyModels (#126)', () => {
  it('same-host models run sequentially (second starts only after first ends)', async () => {
    const order: string[] = [];
    const streamOllama = vi.fn().mockImplementation(async (model: string) => {
      order.push(`start:${model}`);
      await new Promise(r => setTimeout(r, 10));
      order.push(`end:${model}`);
    });

    await runManyModels(
      ['llama3:8b', 'mistral:7b'],
      [{ role: 'user', content: 'hi' }],
      () => {},
      { defaultBaseUrl: DEFAULT_URL, connectedModels: [], connections: [], streamOllama }
    );

    expect(order).toEqual(['start:llama3:8b', 'end:llama3:8b', 'start:mistral:7b', 'end:mistral:7b']);
  });

  it('different-host models may overlap (both started before either ends)', async () => {
    const starts: string[] = [];
    let resolve1!: () => void, resolve2!: () => void;
    const streamOllama = vi.fn().mockImplementation(async (model: string) => {
      starts.push(model);
      await new Promise<void>(r => model === 'llama3:8b' ? (resolve1 = r) : (resolve2 = r));
    });
    const streamOpenAi = vi.fn().mockImplementation(async (conn: any, model: string) => {
      starts.push(model);
      await new Promise<void>(r => (resolve2 = r));
    });

    const done = runManyModels(
      ['loc/llama3', 'rem/gpt4'],
      [{ role: 'user', content: 'hi' }],
      () => {},
      {
        defaultBaseUrl: DEFAULT_URL,
        connectedModels: [localA, remoteC],
        connections: [connLoc, connRem],
        streamOllama,
        streamOpenAi,
      }
    );

    // Give event loop a tick for both to start
    await new Promise(r => setTimeout(r, 5));
    // Both should have started before either resolves (proving parallel execution)
    expect(starts).toContain('llama3:8b');
    expect(starts).toContain('gpt-4');
    resolve1(); resolve2();
    await done;
  });

  it('cancel aborts all pending and running streams', async () => {
    const ac = new AbortController();
    const streamOllama = vi.fn().mockImplementation(async (_m: string, _msgs: any[], _onChunk: any, _ep: string, _cloud: boolean, _opts: any, signal?: AbortSignal) => {
      await new Promise<void>((_, rej) => {
        signal?.addEventListener('abort', () => rej(new Error('aborted')));
      });
    });

    const done = runManyModels(
      ['llama3:8b', 'mistral:7b'],
      [],
      () => {},
      { defaultBaseUrl: DEFAULT_URL, connectedModels: [], connections: [], streamOllama, signal: ac.signal }
    );
    await new Promise(r => setTimeout(r, 5));
    ac.abort();
    // Should resolve without throwing
    await expect(done).resolves.toBeUndefined();
  });

  it('onUpdate receives streaming deltas then done state', async () => {
    const updates: { modelId: string; state: ModelReply['state'] }[] = [];
    const streamOllama = vi.fn().mockImplementation(async (_model: string, _msgs: any[], onChunk: any) => {
      onChunk({ message: { content: 'Hello ' } });
      onChunk({ message: { content: 'world' } });
    });

    await runManyModels(
      ['ministral-3:3b'],
      [],
      (modelId, _delta, state) => updates.push({ modelId, state }),
      { defaultBaseUrl: DEFAULT_URL, connectedModels: [], connections: [], streamOllama }
    );

    expect(updates[0]).toEqual({ modelId: 'ministral-3:3b', state: 'streaming' });
    expect(updates[updates.length - 1]).toEqual({ modelId: 'ministral-3:3b', state: 'done' });
  });

  it('stream error marks model as error state without throwing', async () => {
    const updates: { modelId: string; state: ModelReply['state'] }[] = [];
    const streamOllama = vi.fn().mockRejectedValue(new Error('connection refused'));

    await runManyModels(
      ['llama3:8b'],
      [],
      (modelId, _d, state) => updates.push({ modelId, state }),
      { defaultBaseUrl: DEFAULT_URL, connectedModels: [], connections: [], streamOllama }
    );

    const last = updates[updates.length - 1];
    expect(last.state).toBe('error');
  });
});
