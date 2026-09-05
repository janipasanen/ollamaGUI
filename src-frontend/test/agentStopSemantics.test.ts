/**
 * What "Stop" must mean, on both agent protocols (#577, #578, #591).
 *
 * These three bugs shared a theme: the app told the user a run had stopped
 * while it kept acting, or kept the UI hostage because a terminal callback
 * never fired. The contract pinned here is:
 *   - no queued tool runs after the signal aborts (#577)
 *   - exactly one terminal callback on every exit path (#578)
 *   - a cancel is never dressed up as a completed run (#578, #591)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { agenticChatStream } from '../services/agent';
import { openaiAgenticChatStream } from '../services/openaiAgent';
import { toolRegistry } from '../services/tools';

const CONN = { baseUrl: 'http://localhost:1234' };

/** An Ollama /api/chat response that requests three tool calls in one turn. */
function ollamaToolBatch(): any {
  const body = JSON.stringify({
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [
        { function: { name: 'touch', arguments: { n: 1 } } },
        { function: { name: 'touch', arguments: { n: 2 } } },
        { function: { name: 'touch', arguments: { n: 3 } } },
      ],
    },
    done: true,
  }) + '\n';
  const enc = new TextEncoder();
  let sent = false;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: () => sent
          ? Promise.resolve({ done: true, value: undefined })
          : ((sent = true), Promise.resolve({ done: false, value: enc.encode(body) })),
        cancel: () => Promise.resolve(),
      }),
    },
  };
}

/** The same batch in the OpenAI streaming dialect. */
function openAiToolBatch(): any {
  const frames = [
    'data: {"choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[' +
      '{"index":0,"id":"c1","type":"function","function":{"name":"touch","arguments":"{\\"n\\":1}"}},' +
      '{"index":1,"id":"c2","type":"function","function":{"name":"touch","arguments":"{\\"n\\":2}"}},' +
      '{"index":2,"id":"c3","type":"function","function":{"name":"touch","arguments":"{\\"n\\":3}"}}' +
      ']},"finish_reason":null}]}',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    'data: [DONE]',
  ];
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: () => i < frames.length
          ? Promise.resolve({ done: false, value: enc.encode(frames[i++] + '\n\n') })
          : Promise.resolve({ done: true, value: undefined }),
        cancel: () => Promise.resolve(),
      }),
    },
  };
}

let executed: number[] = [];

beforeEach(() => {
  executed = [];
  localStorage.clear();
  // Auto autonomy: no approval gate, so nothing but the abort check stands
  // between a queued tool and the user's files. This is the risky setting the
  // bug actually bit in.
  localStorage.setItem('agent_autonomy_level', 'auto');
});

afterEach(() => {
  toolRegistry.unregisterTool('touch');
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Register a tool that aborts the run the first time it is called. */
function registerAbortingTool(controller: AbortController) {
  toolRegistry.registerTool({
    name: 'touch', description: 'Records that it ran', readOnly: false,
    parameters: { type: 'object', properties: { n: { type: 'number', description: 'call index' } }, required: ['n'] },
    execute: async ({ n }: any) => {
      executed.push(Number(n));
      // The user presses Stop while the first tool is running.
      controller.abort();
      return { ok: true };
    },
  });
}

describe('Stop halts a queued tool batch (#577)', () => {
  it('Ollama loop runs no further tools once the signal aborts', async () => {
    const controller = new AbortController();
    registerAbortingTool(controller);
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(ollamaToolBatch())) as any;

    const results: unknown[] = [];
    const gen = agenticChatStream({
      model: 'llama3', endpoint: 'http://localhost:11434/api/chat',
      messages: [{ role: 'user', content: 'do three things' }],
      maxIterations: 3, signal: controller.signal,
      onToolResult: r => results.push(r),
    });
    for await (const _m of gen) { /* drain */ }

    // Before the fix all three ran — under 'auto' that is three real writes
    // after the user pressed Stop.
    expect(executed).toEqual([1]);
    // Only the executed call produces a result. (Note: unlike the OpenAI loop,
    // this one fires onToolCall while PARSING the stream, so all three are
    // announced before any of them runs; the result callback is what tracks
    // what actually happened.)
    expect(results).toHaveLength(1);
  });

  it('OpenAI loop behaves identically — the same Stop, the same guarantee', async () => {
    const controller = new AbortController();
    registerAbortingTool(controller);
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(openAiToolBatch())) as any;

    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen', messages: [{ role: 'user', content: 'do three things' }],
      maxIterations: 3, signal: controller.signal,
    });
    for await (const _m of gen) { /* drain */ }

    expect(executed).toEqual([1]);
  });
});

describe('parallel tool calls in one turn are not deduplicated away', () => {
  it('keeps two calls to the same tool with different arguments', async () => {
    // Ollama sends `arguments` as an OBJECT. The dedup key interpolated it
    // straight into a template string, so every call stringified to
    // "[object Object]" and only the first survived — a model asking to read
    // three files in one turn had two of them silently dropped.
    toolRegistry.registerTool({
      name: 'touch', description: 'Records that it ran', readOnly: true,
      parameters: { type: 'object', properties: { n: { type: 'number', description: 'call index' } }, required: ['n'] },
      execute: async ({ n }: any) => { executed.push(Number(n)); return { ok: true }; },
    });
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(ollamaToolBatch())) as any;

    const gen = agenticChatStream({
      model: 'llama3', endpoint: 'http://localhost:11434/api/chat',
      messages: [{ role: 'user', content: 'do three things' }],
      maxIterations: 1,
    });
    for await (const _m of gen) { /* drain */ }

    expect(executed).toEqual([1, 2, 3]);
  });

  it('still collapses a genuine duplicate repeated across stream chunks', async () => {
    // The dedup exists because a tool call can arrive twice in one stream;
    // fixing the key must not reopen that.
    toolRegistry.registerTool({
      name: 'touch', description: 'Records that it ran', readOnly: true,
      parameters: { type: 'object', properties: { n: { type: 'number', description: 'call index' } }, required: ['n'] },
      execute: async ({ n }: any) => { executed.push(Number(n)); return { ok: true }; },
    });
    const enc = new TextEncoder();
    const dup = { function: { name: 'touch', arguments: { n: 7 } } };
    const lines = [
      JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [dup] } }),
      JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [dup] }, done: true }),
    ].join('\n') + '\n';
    let sent = false;
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      body: { getReader: () => ({
        read: () => sent ? Promise.resolve({ done: true, value: undefined })
          : ((sent = true), Promise.resolve({ done: false, value: enc.encode(lines) })),
        cancel: () => Promise.resolve(),
      }) },
    })) as any;

    const gen = agenticChatStream({
      model: 'llama3', endpoint: 'http://localhost:11434/api/chat',
      messages: [{ role: 'user', content: 'go' }], maxIterations: 1,
    });
    for await (const _m of gen) { /* drain */ }

    expect(executed).toEqual([7]);
  });
});

describe('every exit path fires exactly one terminal callback (#578)', () => {
  it('a cancelled OpenAI run still calls onComplete, so the UI can unlock', async () => {
    // App.tsx clears isLoading/agentStatus ONLY from onComplete. Returning
    // early on cancel left the composer disabled and the spinner turning.
    const controller = new AbortController();
    global.fetch = vi.fn().mockImplementation(() => {
      controller.abort();
      const err: any = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as any;

    let cancels = 0, completes = 0;
    const yielded: any[] = [];
    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen', messages: [{ role: 'user', content: 'go' }],
      maxIterations: 5, signal: controller.signal,
      onCancel: () => { cancels++; }, onComplete: () => { completes++; },
    });
    for await (const m of gen) yielded.push(m);

    expect(cancels).toBe(1);
    expect(completes).toBe(1);
    // A user Stop must never be reported as hitting the iteration limit.
    expect(yielded.some(m => String(m.content).startsWith('⚠️ Agent stopped'))).toBe(false);
  });

  it('a cancel on the FINAL iteration is not reported as max-iterations', async () => {
    // The loop derives the max-iterations verdict from the counter, so without
    // the `stopped` guard a late cancel produced a bogus "Continue agent".
    const controller = new AbortController();
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      calls++;
      if (calls >= 2) {
        controller.abort();
        const err: any = new Error('aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      }
      return Promise.resolve(openAiToolBatch());
    }) as any;
    toolRegistry.registerTool({
      name: 'touch', description: 'noop', readOnly: true,
      parameters: { type: 'object', properties: { n: { type: 'number', description: 'i' } }, required: ['n'] },
      execute: async () => ({ ok: true }),
    });

    const yielded: any[] = [];
    let maxHits = 0;
    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen', messages: [{ role: 'user', content: 'go' }],
      maxIterations: 2, signal: controller.signal,
      onMaxIterations: () => { maxHits++; },
    });
    for await (const m of gen) yielded.push(m);

    expect(maxHits).toBe(0);
    expect(yielded.some(m => String(m.content).startsWith('⚠️ Agent stopped'))).toBe(false);
  });

  it('a non-abort failure reports the error AND completes', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connection refused')) as any;
    let errors = 0, completes = 0;
    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen', messages: [{ role: 'user', content: 'go' }],
      onError: () => { errors++; }, onComplete: () => { completes++; },
    });
    for await (const _m of gen) { /* drain */ }
    expect(errors).toBe(1);
    expect(completes).toBe(1);
  });
});
