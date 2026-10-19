/**
 * Model fallback in the agent loop (#669).
 *
 * Pins the decision points: a model-scoped failure retries the same turn on the
 * next model and the run stays there; a request-scoped failure, an abort, or an
 * exhausted chain does not switch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { agenticChatStream } from '../services/agent';
import { toolRegistry } from '../services/tools';

function streamResponse(lines: string[]) {
  const text = lines.join('\n') + '\n';
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => {
            if (!sent) { sent = true; return { done: false, value: new TextEncoder().encode(text) }; }
            return { done: true, value: undefined };
          },
        };
      },
    },
  };
}

const finalLine = (content: string) => JSON.stringify({ message: { role: 'assistant', content }, done: true });
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

beforeEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
});
afterEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
  vi.restoreAllMocks();
});

describe('model fallback (#669)', () => {
  it('retries the same turn on the next model and stays there', async () => {
    const models: string[] = [];
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      models.push(body.model);
      if (body.model === 'bad:1b') throw httpError(500, 'failed to load model');
      return streamResponse([finalLine('second model answers')]);
    }) as never;

    const switches: Array<{ from: string; to: string }> = [];
    const out: string[] = [];
    for await (const m of agenticChatStream({
      model: 'bad:1b', messages: [{ role: 'user', content: 'go' }], maxIterations: 1,
      endpoint: 'http://x/api/chat', fallbackModels: ['good:8b', 'also:1b'],
      onModelSwitch: s => switches.push(s),
    })) out.push(m.content);

    expect(models).toEqual(['bad:1b', 'good:8b']);
    expect(switches).toEqual([{ from: 'bad:1b', to: 'good:8b', reason: expect.stringContaining('failed to load model') }]);
    expect(out.join('\n')).toContain('Switched from **bad:1b** to **good:8b**');
    expect(out.join('\n')).toContain('second model answers');
  });

  it('tries each model at most once, then surfaces the original failure', async () => {
    const models: string[] = [];
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      models.push(body.model);
      throw httpError(500, `cannot load ${body.model}`);
    }) as never;

    const errors: string[] = [];
    const out: string[] = [];
    for await (const m of agenticChatStream({
      model: 'a', messages: [{ role: 'user', content: 'go' }], maxIterations: 1,
      endpoint: 'http://x/api/chat', fallbackModels: ['b', 'c'],
      onError: e => errors.push(e.message),
    })) out.push(m.content);

    expect(models).toEqual(['a', 'b', 'c']);
    expect(errors).toEqual(['cannot load c']); // the last failure, once
    expect(out.join('\n')).toContain('Error: cannot load c');
  });

  it('does not switch on a context-length error', async () => {
    const models: string[] = [];
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      models.push(JSON.parse(String(init.body)).model);
      throw Object.assign(new Error('context length exceeded'), { status: 400 });
    }) as never;

    for await (const _ of agenticChatStream({
      model: 'a', messages: [{ role: 'user', content: 'go' }], maxIterations: 1,
      endpoint: 'http://x/api/chat', fallbackModels: ['b'],
    })) { /* drain */ }

    expect(models).toEqual(['a']);
  });

  it('does not switch on an abort', async () => {
    const controller = new AbortController();
    const models: string[] = [];
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      models.push(JSON.parse(String(init.body)).model);
      controller.abort();
      const err = new Error('aborted'); err.name = 'AbortError'; throw err;
    }) as never;

    for await (const _ of agenticChatStream({
      model: 'a', messages: [{ role: 'user', content: 'go' }], maxIterations: 1,
      endpoint: 'http://x/api/chat', fallbackModels: ['b'], signal: controller.signal,
    })) { /* drain */ }

    expect(models).toEqual(['a']);
  });

  it('does not switch once output has been streamed', async () => {
    const models: string[] = [];
    let firstCall = true;
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      models.push(JSON.parse(String(init.body)).model);
      if (firstCall) {
        firstCall = false;
        // Emit a chunk, then fail mid-stream: replaying on another model would
        // duplicate the partial answer.
        return {
          ok: true, status: 200,
          body: {
            getReader: () => {
              let step = 0;
              return {
                read: async () => {
                  step++;
                  if (step === 1) return { done: false, value: new TextEncoder().encode(JSON.stringify({ message: { role: 'assistant', content: 'partial' } }) + '\n') };
                  throw httpError(500, 'failed to load model');
                },
              };
            },
          },
        };
      }
      return streamResponse([finalLine('full answer')]);
    }) as never;

    for await (const _ of agenticChatStream({
      model: 'a', messages: [{ role: 'user', content: 'go' }], maxIterations: 1,
      endpoint: 'http://x/api/chat', fallbackModels: ['b'],
    })) { /* drain */ }

    expect(models).toEqual(['a']);
  });

  it('is inert when no chain is configured', async () => {
    const models: string[] = [];
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      models.push(JSON.parse(String(init.body)).model);
      throw httpError(500, 'failed to load model');
    }) as never;

    for await (const _ of agenticChatStream({
      model: 'a', messages: [{ role: 'user', content: 'go' }], maxIterations: 1,
      endpoint: 'http://x/api/chat',
    })) { /* drain */ }

    expect(models).toEqual(['a']);
  });
});
