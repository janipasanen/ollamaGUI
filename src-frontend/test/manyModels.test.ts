/**
 * Many-models fan-out (#126 / #424): unit tests for the pure helpers
 * `hasSameHostConflict` and `groupByHost`, plus the injected-stream
 * `runManyModels` orchestrator (no network).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  hasSameHostConflict,
  groupByHost,
  runManyModels,
} from '../services/manyModels';
import type { ModelConnection, ConnectedModel } from '../services/connections';
import type { Message } from '../services/ollama';

const DEFAULT_BASE = 'http://localhost:11434';

const connLocal2: ModelConnection = {
  id: 'c-local2',
  name: 'Local2',
  kind: 'ollama',
  baseUrl: 'http://localhost:11435',
  enabled: true,
};
const connRemote: ModelConnection = {
  id: 'c-remote',
  name: 'Remote',
  kind: 'ollama',
  baseUrl: 'http://gpu-box:11434',
  enabled: true,
};
const connOpenAi: ModelConnection = {
  id: 'c-openai',
  name: 'OpenAICompat',
  kind: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-x',
  enabled: true,
};

const cmRemote: ConnectedModel = {
  id: 'c-remote/llama3:70b',
  name: 'llama3:70b',
  connectionId: 'c-remote',
  connectionName: 'Remote',
  kind: 'ollama',
};
const cmOpenAi: ConnectedModel = {
  id: 'c-openai/gpt-4o',
  name: 'gpt-4o',
  connectionId: 'c-openai',
  connectionName: 'OpenAICompat',
  kind: 'openai',
};

const connections = [connLocal2, connRemote, connOpenAi];
const connectedModels = [cmRemote, cmOpenAi];

describe('hasSameHostConflict (#126)', () => {
  it('two local default-host models → true', () => {
    expect(hasSameHostConflict(['llama3:8b', 'mistral:7b'], DEFAULT_BASE, connectedModels, connections)).toBe(true);
  });
  it('two distinct connections → false', () => {
    expect(
      hasSameHostConflict([cmRemote.id, cmOpenAi.id], DEFAULT_BASE, connectedModels, connections),
    ).toBe(false);
  });
  it('mixed default + connected → false', () => {
    expect(
      hasSameHostConflict(['llama3:8b', cmRemote.id], DEFAULT_BASE, connectedModels, connections),
    ).toBe(false);
  });
  it('single model → false', () => {
    expect(hasSameHostConflict(['llama3:8b'], DEFAULT_BASE, connectedModels, connections)).toBe(false);
  });
  it('trailing slash normalised when comparing hosts', () => {
    expect(
      hasSameHostConflict(['llama3:8b', 'mistral:7b'], 'http://localhost:11434/', connectedModels, connections),
    ).toBe(true);
  });
});

describe('groupByHost (#126)', () => {
  it('groups default-host models together', () => {
    const groups = groupByHost(['llama3:8b', 'mistral:7b'], DEFAULT_BASE, connectedModels, connections);
    expect(groups).toHaveLength(1);
    expect(groups[0].host).toBe(DEFAULT_BASE);
    expect(groups[0].models).toEqual(['llama3:8b', 'mistral:7b']);
  });
  it('splits connected models by connection baseUrl', () => {
    const groups = groupByHost([cmRemote.id, cmOpenAi.id], DEFAULT_BASE, connectedModels, connections);
    expect(groups).toHaveLength(2);
    const hosts = groups.map(g => g.host).sort();
    expect(hosts).toEqual(['http://gpu-box:11434', 'https://api.example.com/v1'].sort());
  });
  it('keeps order within a batch', () => {
    const groups = groupByHost(['a', 'b', cmRemote.id, 'c'], DEFAULT_BASE, connectedModels, connections);
    const localGroup = groups.find(g => g.host === DEFAULT_BASE)!;
    expect(localGroup.models).toEqual(['a', 'b', 'c']);
  });
});

describe('runManyModels (#126)', () => {
  const messages: Message[] = [{ role: 'user', content: 'hi' }];

  function makeStreamOllama(tokens: Record<string, string[]>) {
    const calls: { model: string; t: number }[] = [];
    let counter = 0;
    const streamOllama = vi.fn().mockImplementation(
      async (model: string, _msgs: Message[], onChunk: (c: any) => void) => {
        const idx = counter++;
        calls.push({ model, t: Date.now() });
        // simulate small delay so parallel/sequential timing is observable
        await new Promise(r => setTimeout(r, 5));
        for (const tok of tokens[model] ?? ['x']) {
          onChunk({ message: { content: tok } });
        }
        void idx;
      },
    );
    return { streamOllama, calls };
  }

  it('reports streaming → done for each model and aggregates chunks', async () => {
    const { streamOllama } = makeStreamOllama({
      'llama3:8b': ['Hel', 'lo'],
      'mistral:7b': ['Yo'],
    });
    const updates: { id: string; delta: string; state: string }[] = [];
    await runManyModels(
      ['llama3:8b', 'mistral:7b'],
      messages,
      (id, delta, state) => updates.push({ id, delta, state }),
      { defaultBaseUrl: DEFAULT_BASE, connectedModels, connections, streamOllama },
    );
    const llama = updates.filter(u => u.id === 'llama3:8b');
    expect(llama[0].state).toBe('streaming');
    expect(llama.some(u => u.delta === 'Hel')).toBe(true);
    expect(llama.some(u => u.delta === 'lo')).toBe(true);
    expect(llama[llama.length - 1].state).toBe('done');
    const mistral = updates.filter(u => u.id === 'mistral:7b');
    expect(mistral[mistral.length - 1].state).toBe('done');
  });

  it('runs same-host models sequentially (call order preserved)', async () => {
    const { streamOllama, calls } = makeStreamOllama({
      'llama3:8b': ['a'],
      'mistral:7b': ['b'],
    });
    await runManyModels(
      ['llama3:8b', 'mistral:7b'],
      messages,
      () => {},
      { defaultBaseUrl: DEFAULT_BASE, connectedModels, connections, streamOllama },
    );
    expect(streamOllama).toHaveBeenCalledTimes(2);
    // same host → single batch → sequential calls in input order
    expect(calls.map(c => c.model)).toEqual(['llama3:8b', 'mistral:7b']);
  });

  it('runs different-host batches in parallel', async () => {
    const { streamOllama } = makeStreamOllama({
      'llama3:8b': ['a'],
      'llama3:70b': ['b'],
    });
    // monkeypatch to record overlapping execution windows
    const windows: Record<string, [number, number]> = {};
    streamOllama.mockImplementation(async (model: string, _m: Message[], _c: any) => {
      const start = Date.now();
      await new Promise(r => setTimeout(r, 30));
      windows[model] = [start, Date.now()];
    });
    await runManyModels(
      ['llama3:8b', cmRemote.id],
      messages,
      () => {},
      { defaultBaseUrl: DEFAULT_BASE, connectedModels, connections, streamOllama },
    );
    // Remote model resolves to a different host → batches overlap
    const localWin = windows['llama3:8b'];
    const remoteWin = windows[cmRemote.name];
    expect(localWin).toBeDefined();
    expect(remoteWin).toBeDefined();
    expect(remoteWin[0]).toBeLessThan(localWin[1]);
  });

  it('abort signal breaks out of sequential batch', async () => {
    const controller = new AbortController();
    const { streamOllama } = makeStreamOllama({ 'llama3:8b': ['a'], 'mistral:7b': ['b'] });
    let firstCall = true;
    streamOllama.mockImplementation(async (model: string) => {
      if (firstCall) {
        firstCall = false;
        controller.abort();
      }
      await new Promise(r => setTimeout(r, 5));
      return;
    });
    const updates: { id: string; state: string }[] = [];
    await runManyModels(
      ['llama3:8b', 'mistral:7b'],
      messages,
      (id, _d, state) => updates.push({ id, state }),
      { defaultBaseUrl: DEFAULT_BASE, connectedModels, connections, streamOllama, signal: controller.signal },
    );
    // second model never started streaming content because signal aborted before its loop iteration
    expect(streamOllama).toHaveBeenCalledTimes(1);
  });

  it('surfaces stream error as state "error"', async () => {
    const streamOllama = vi.fn().mockRejectedValue(new Error('boom'));
    const updates: { id: string; state: string; error?: string }[] = [];
    await runManyModels(
      ['llama3:8b'],
      messages,
      (id, _d, state, error) => updates.push({ id, state, error }),
      { defaultBaseUrl: DEFAULT_BASE, connectedModels, connections, streamOllama },
    );
    expect(updates.some(u => u.state === 'error' && u.error === 'boom')).toBe(true);
  });

  it('routes OpenAI-kind connected models through streamOpenAi', async () => {
    const streamOllama = vi.fn();
    const streamOpenAi = vi.fn().mockImplementation(
      async (_conn: ModelConnection, _model: string, _msgs: Message[], onChunk: (d: string, r?: string) => void) => {
        onChunk('hi', 'thinking...');
      },
    );
    const updates: { id: string; delta: string; reasoning?: string; state: string }[] = [];
    await runManyModels(
      [cmOpenAi.id],
      messages,
      (id, delta, state, _e, reasoning) => updates.push({ id, delta, state, reasoning }),
      { defaultBaseUrl: DEFAULT_BASE, connectedModels, connections, streamOllama, streamOpenAi },
    );
    expect(streamOpenAi).toHaveBeenCalledTimes(1);
    expect(streamOllama).not.toHaveBeenCalled();
    expect(updates.some(u => u.delta === 'hi')).toBe(true);
    expect(updates.some(u => u.reasoning === 'thinking...')).toBe(true);
  });
});
