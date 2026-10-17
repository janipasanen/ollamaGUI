import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openAiAgenticChatStream } from '../services/openAiAgent';
import { toolRegistry } from '../services/tools';
import type { ModelConnection } from '../services/connections';

/** Build a fake OpenAI connection. */
function makeConn(): ModelConnection {
  return {
    id: 'openai-test',
    name: 'Switchyard',
    kind: 'openai',
    baseUrl: 'http://switchyard.test',
    enabled: true,
  };
}

/** Assemble an OpenAI SSE stream body from an array of chunk objects. */
function sse(chunks: unknown[]): string {
  return chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('');
}

/** OpenAI-style chunk helper. */
function chunk(choices: unknown): unknown {
  return { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices };
}

/**
 * Install a `globalThis.fetch` that streams `body` as realistic SSE frames
 * (each terminated by `\n\n`) on every call. Returns the live call count.
 */
function installSseFetch(body: string): { count: () => number } {
  const encoder = new TextEncoder();
  const frames = body.split('\n\n').filter((f) => f.trim());
  let callCount = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => {
    callCount++;
    let i = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (i < frames.length) return { done: false, value: encoder.encode(frames[i++] + '\n\n') };
            return { done: true, value: undefined };
          },
          return: async () => ({ done: true, value: undefined }),
        }),
      },
    };
  });
  return { count: () => callCount };
}

/**
 * Install a per-call-count mock. `route(n)` (0-based) returns the body for the
 * nth call; it may return a full `Response`-like object to simulate errors.
 */
function installRouteFetch(route: (callIndex: number) => unknown): { count: () => number } {
  const encoder = new TextEncoder();
  let callCount = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => {
    const body = route(callCount);
    callCount++;
    if (typeof body === 'object' && body !== null && 'ok' in body) {
      // Caller supplied a full response-like object (e.g. an error response).
      return body as Response;
    }
    const frames = (body as string).split('\n\n').filter((f) => f.trim());
    let i = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (i < frames.length) return { done: false, value: encoder.encode(frames[i++] + '\n\n') };
            return { done: true, value: undefined };
          },
          return: async () => ({ done: true, value: undefined }),
        }),
      },
    };
  });
  return { count: () => callCount };
}

const conn = makeConn();

/** Fully consume the generator (needed — `await` alone does not iterate it). */
const run = async (opts: Parameters<typeof openAiAgenticChatStream>[0]) => {
  for await (const _ of openAiAgenticChatStream(opts)) {
    // discard
  }
};

/** A read-only tool so the autonomy gate never blocks it. */
beforeEach(() => {
  toolRegistry.registerTool({
    name: 'add_numbers',
    description: 'Add two numbers',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        a: { type: 'integer', description: 'First addend' },
        b: { type: 'integer', description: 'Second addend' },
      },
      required: ['a', 'b'],
    },
    execute: async (params: Record<string, number>) => ({ sum: (params.a ?? 0) + (params.b ?? 0) }),
  });
});

describe('openAiAgenticChatStream — OpenAI tool-calling loop', () => {
  it('executes a tool call returned by an OpenAI stream and feeds the result back', async () => {
    // Call 1: model requests `add_numbers`. Call 2: final answer, no tools.
    const counter = installRouteFetch((n) => (n === 0 ? toolChunks : finalChunks));
    const toolChunks = sse([
      chunk([{ index: 0, delta: { role: 'assistant', content: '' } }]),
      chunk([
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: 'call_1', function: { name: 'add_numbers' } },
              { index: 0, function: { arguments: '{"a": ' } },
              { index: 0, function: { arguments: '2, ' } },
              { index: 0, function: { arguments: '"b": ' } },
              { index: 0, function: { arguments: '4}' } },
            ],
          },
        },
      ]),
      chunk([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]),
    ]);
    const finalChunks = sse([
      chunk([{ index: 0, delta: { role: 'assistant', content: '' } }]),
      chunk([{ index: 0, delta: { content: 'The sum is 6.' } }]),
      chunk([{ index: 0, delta: {}, finish_reason: 'stop' }]),
    ]);

    const events: string[] = [];
    let toolArgs: Record<string, unknown> | undefined;
    let finalText = '';

    await run({
      conn,
      model: 'switchyard/ornith35',
      messages: [{ role: 'user', content: 'Add 2 and 4.' }],
      maxIterations: 5,
      options: { temperature: 0.1 },
      onToolCall: (tc) => {
        events.push(`call:${tc.function?.name}`);
        toolArgs = (typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function?.arguments ?? {})) as Record<string, unknown>;
      },
      onToolResult: (r) => events.push(`result:${r.name}`),
      onAssistantMessage: (m) => { if (!m.startsWith('⚠️')) finalText = m; },
    });

    // Second request returned the final answer.
    // Tool was called exactly once with parsed args.
    expect(events).toContain('call:add_numbers');
    expect(toolArgs).toEqual({ a: 2, b: 4 });
    // The tool result was executed and fed back (result message present).
    expect(events).toContain('result:add_numbers');
    // Two requests total (one tool-calling turn + final turn).
    expect(counter.count()).toBe(2);
    expect(finalText).toBe('The sum is 6.');
  });

  it('re-sends a persisted tool turn as VALID OpenAI history (#579)', async () => {
    // A follow-up turn on a persisted session. The prior tool turn was saved
    // by the UI in the internal Message shape: an assistant message carrying
    // tool_calls, followed by a tool message that records only name/content.
    const bodies: string[] = [];
    const encoder = new TextEncoder();
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (_url: unknown, init: { body?: string } | undefined) => {
      if (init?.body) bodies.push(init.body);
      const frames = bodies.length === 1
        ? sse([chunk([{ index: 0, delta: { content: 'ok' } }]), chunk([{ index: 0, delta: {}, finish_reason: 'stop' }])])
        : '';
      return { ok: true, status: 200, body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) } };
    });

    await run({
      conn,
      model: 'switchyard/ornith35',
      messages: [
        { role: 'user', content: 'Add 2 and 4.' },
        {
          role: 'assistant',
          content: 'Calling tool: add_numbers',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add_numbers', arguments: '{"a":2,"b":4}' } }],
        },
        { role: 'tool', name: 'add_numbers', content: '6' },
        { role: 'user', content: 'thanks' },
      ],
      maxIterations: 1,
    });

    // The first request must carry valid OpenAI history: the tool message's
    // tool_call_id has to match the assistant message's tool call id,
    // otherwise strict servers 400.
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    const firstBody = JSON.parse(bodies[0]) as { messages: any[] };
    expect(firstBody.messages.length).toBe(4);
    const assistant = firstBody.messages.find((m) => m.role === 'assistant' && m.tool_calls);
    const toolMsg = firstBody.messages.find((m) => m.role === 'tool');
    expect(assistant).toBeTruthy();
    expect(toolMsg).toBeTruthy();
    const toolCallId = assistant.tool_calls[0].id;
    expect(toolCallId).toBe('call_1');
    // The bug: tool messages record only name/content, so the reconstructed
    // tool_call_id may not match the persisted assistant tool call id.
    expect(toolMsg.tool_call_id).toBe(toolCallId);
  });

  it('matches each parallel tool result to the right call id (#579)', async () => {
    // A single assistant message requests the SAME tool twice. The persisted
    // tool messages carry only name/content, so a name-only lookup cannot tell
    // which call-1 vs call-2 each result belongs to.
    const bodies: string[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (_url: unknown, init: { body?: string } | undefined) => {
      if (init?.body) bodies.push(init.body);
      return { ok: true, status: 200, body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) } };
    });

    await run({
      conn,
      model: 'switchyard/ornith35',
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'add_numbers', arguments: '{"a":1,"b":1}' } },
            { id: 'call-2', type: 'function', function: { name: 'add_numbers', arguments: '{"a":2,"b":2}' } },
          ],
        },
        { role: 'tool', name: 'add_numbers', content: '2', tool_call_id: 'call-1' },
        { role: 'tool', name: 'add_numbers', content: '4', tool_call_id: 'call-2' },
        { role: 'user', content: 'ok' },
      ],
      maxIterations: 1,
    });

    const firstBody = JSON.parse(bodies[0]) as { messages: any[] };
    const toolMsgs = firstBody.messages.filter((m) => m.role === 'tool');
    const assistant = firstBody.messages.find((m) => m.role === 'assistant' && m.tool_calls);
    // Both persisted call ids must be represented so no call is left unanswered.
    const toolCallIds = toolMsgs.map((t) => t.tool_call_id);
    expect(toolCallIds).toContain('call-1');
    expect(toolCallIds).toContain('call-2');
    expect(toolCallIds.length).toBe(2);
    // Each tool message's id must match a real tool call on the assistant side.
    const validIds = assistant.tool_calls.map((tc: any) => tc.id);
    for (const id of toolCallIds) {
      expect(validIds).toContain(id);
    }
  });

  it('streams text and reasoning deltas inline', async () => {
    const chunks = sse([
      chunk([{ index: 0, delta: { role: 'assistant', content: '' } }]),
      chunk([{ index: 0, delta: { reasoning: 'let me' } }]),
      chunk([{ index: 0, delta: { reasoning: ', think' } }]),
      chunk([{ index: 0, delta: { content: 'Hello' } }]),
      chunk([{ index: 0, delta: { content: ', world!' } }]),
      chunk([{ index: 0, delta: {}, finish_reason: 'stop' }]),
    ]);

    const counter = installSseFetch(chunks);

    const contents: string[] = [];
    const reasonings: string[] = [];
    await run({
      conn,
      model: 'switchyard/ornith35',
      messages: [{ role: 'user', content: 'Hi' }],
      onAssistantMessage: m => contents.push(m),
      onAssistantReasoning: r => reasonings.push(r),
    });

    expect(counter.count()).toBe(1);
    // Text arrived incrementally: onAssistantMessage receives the cumulative
    // message, so we see each new prefix, ending on the full text.
    expect(contents.length).toBeGreaterThanOrEqual(2);
    expect(contents[contents.length - 1]).toBe('Hello, world!');
    expect(contents.slice(0, 2)).toEqual(['Hello', 'Hello, world!']);
    // Reasoning streamed then settled to the full value.
    expect(reasonings.length).toBeGreaterThanOrEqual(1);
    expect(reasonings[reasonings.length - 1]).toBe('let me, think');
  });

  it('honours maxIterations without a final answer', async () => {
    const toolChunks = sse([
      chunk([{ index: 0, delta: { role: 'assistant', content: '' } }]),
      chunk([
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, id: 'call_1', function: { name: 'add_numbers', arguments: '{"a": 1, "b": 1}' } }],
          },
        },
      ]),
      chunk([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]),
    ]);
    const counter = installSseFetch(toolChunks);

    let hitMax = false;
    await run({
      conn,
      model: 'switchyard/ornith35',
      messages: [{ role: 'user', content: 'loop me' }],
      maxIterations: 2,
      onMaxIterations: () => { hitMax = true; },
    });

    expect(counter.count()).toBeGreaterThanOrEqual(2);
    expect(hitMax).toBe(true);
  });

  it('reports a connection error via onError', async () => {
    installRouteFetch(() => ({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({ error: { message: 'boom' } }),
    }));

    let err: Error | undefined;
    await run({
      conn,
      model: 'switchyard/ornith35',
      messages: [{ role: 'user', content: 'hi' }],
      onError: (e) => { err = e; },
    });

    expect(err).toBeInstanceOf(Error);
    expect(String(err?.message)).toMatch(/boom/i);
  });
});
