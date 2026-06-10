import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { agenticChatStream } from '../services/agent';
import { toolRegistry } from '../services/tools';

// Minimal NDJSON stream helper
function makeStream(lines: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(enc.encode(JSON.stringify(line) + '\n'));
      }
      controller.close();
    },
  });
}

function makeFetchMock(lines: object[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    statusText: 'OK',
    body: makeStream(lines),
  });
}

describe('agenticChatStream', () => {
  beforeEach(() => {
    // Unregister any tools that might affect tool_calls branches
    for (const t of toolRegistry.getAllTools()) {
      toolRegistry.unregisterTool(t.name);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('yields assistant message when no tool calls', async () => {
    const fetchMock = makeFetchMock([
      { message: { role: 'assistant', content: 'Hello!' } },
      { message: { role: 'assistant', content: '' }, done: true },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const messages: { role: string; content: string }[] = [];
    for await (const msg of agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      messages.push(msg as { role: string; content: string });
    }

    expect(messages.some(m => m.role === 'assistant' && m.content.includes('Hello!'))).toBe(true);
  });

  it('executes a tool call and yields tool result message', async () => {
    const executeResult = { content: '42', name: 'calculate' };
    vi.spyOn(toolRegistry, 'executeToolCall').mockResolvedValue(executeResult);

    const fetchMock = vi
      .fn()
      // First request → tool call
      .mockResolvedValueOnce({
        ok: true,
        body: makeStream([
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ id: 'call_1', function: { name: 'calculate', arguments: { expr: '6*7' } } }],
            },
          },
        ]),
      })
      // Second request → final answer
      .mockResolvedValueOnce({
        ok: true,
        body: makeStream([{ message: { role: 'assistant', content: 'The answer is 42.' } }]),
      });

    vi.stubGlobal('fetch', fetchMock);

    const toolResults: string[] = [];
    for await (const msg of agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'What is 6*7?' }],
      onToolResult: r => toolResults.push(r.content),
    })) {
      void msg;
    }

    expect(toolResults).toContain('42');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops iterating after maxIterations', async () => {
    // Always returns a tool call so the loop would run forever without the guard
    vi.spyOn(toolRegistry, 'executeToolCall').mockResolvedValue({ content: 'ok', name: 'noop' });

    const infiniteFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeStream([
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'c1', function: { name: 'noop', arguments: {} } }],
          },
        },
      ]),
    });
    vi.stubGlobal('fetch', infiniteFetch);

    const msgs = [];
    for await (const msg of agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'go' }],
      maxIterations: 3,
    })) {
      msgs.push(msg);
    }

    // fetch called at most maxIterations times
    expect(infiniteFetch.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('calls onError and yields error message on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const errors: Error[] = [];
    const yielded: unknown[] = [];
    for await (const msg of agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'test' }],
      onError: e => errors.push(e),
    })) {
      yielded.push(msg);
    }

    expect(errors[0]?.message).toContain('network down');
    expect(yielded.some((m: any) => m.content?.includes('Error:'))).toBe(true);
  });

  it('calls onComplete when iteration finishes normally', async () => {
    vi.stubGlobal('fetch', makeFetchMock([{ message: { role: 'assistant', content: 'done' } }]));

    const completeCb = vi.fn();
    for await (const _ of agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'go' }],
      onComplete: completeCb,
    })) {
      void _;
    }

    expect(completeCb).toHaveBeenCalledOnce();
  });
});
