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

  // ── #457: surface Ollama response body error on non-ok in agentic loop ──

  it('surfaces body .error on non-ok response via onError (#457)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({ error: "model 'llama3' not found, try pulling it first" }),
    }));

    const errors: Error[] = [];
    const yielded: unknown[] = [];
    for await (const msg of agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'test' }],
      onError: e => errors.push(e),
    })) {
      yielded.push(msg);
    }

    expect(errors[0]?.message).toContain("model 'llama3' not found, try pulling it first");
    expect(yielded.some((m: any) => m.content?.includes("model 'llama3' not found"))).toBe(true);
  });

  it('falls back to statusText on non-ok when body has no .error (#457)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({ something: 'else' }),
    }));

    const errors: Error[] = [];
    for await (const _ of agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'test' }],
      onError: e => errors.push(e),
    })) {
      void _;
    }

    expect(errors[0]?.message).toContain('Ollama API error: Internal Server Error');
  });
});


// ── final-turn generation stats (#391, #392) ──────────────────────────────────

describe('agenticChatStream onGenStats (#391, #392)', () => {
  beforeEach(() => {
    for (const t of toolRegistry.getAllTools()) toolRegistry.unregisterTool(t.name);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('emits final-turn genStats with stop reason and prompt tokens', async () => {
    const fetchMock = makeFetchMock([
      { message: { role: 'assistant', content: 'Done.' } },
      { done: true, eval_count: 8, eval_duration: 100_000_000, prompt_eval_count: 60, done_reason: 'stop' },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    let captured: { stopReason?: string; promptCount?: number; evalCount?: number } | undefined;
    for await (const _ of agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'Hi' }],
      onGenStats: (stats) => { captured = stats; },
    })) { /* drain */ }

    expect(captured?.stopReason).toBe('stopped');
    expect(captured?.promptCount).toBe(60);
    expect(captured?.evalCount).toBe(8);
  });

  it('does not emit onGenStats when the final chunk has no stats', async () => {
    const fetchMock = makeFetchMock([
      { message: { role: 'assistant', content: 'No stats here.' } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    let called = false;
    for await (const _ of agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'Hi' }],
      onGenStats: () => { called = true; },
    })) { /* drain */ }

    expect(called).toBe(false);
  });
});

// ── #472: assistant message with tool_calls must be in context for next turn ─

describe('agenticChatStream assistant message in context (#472)', () => {
  beforeEach(() => {
    for (const t of toolRegistry.getAllTools()) toolRegistry.unregisterTool(t.name);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('includes assistant message with tool_calls in the second request (#472)', async () => {
    vi.spyOn(toolRegistry, 'executeToolCall').mockResolvedValue({ content: '42', name: 'calculate' });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        body: makeStream([
          {
            message: {
              role: 'assistant',
              content: 'Let me calculate that.',
              tool_calls: [{ id: 'call_1', function: { name: 'calculate', arguments: { expr: '6*7' } } }],
            },
          },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: makeStream([{ message: { role: 'assistant', content: 'The answer is 42.' } }]),
      });
    vi.stubGlobal('fetch', fetchMock);

    for await (const _ of agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'What is 6*7?' }],
    })) { void _; }

    // The second fetch call's body should contain the assistant message
    // with content and tool_calls, before the tool result
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const messages = secondCallBody.messages;
    
    // Find the assistant message that has tool_calls
    const assistantWithTools = messages.find((m: any) => m.role === 'assistant' && m.tool_calls);
    expect(assistantWithTools).toBeDefined();
    expect(assistantWithTools.content).toContain('Let me calculate that.');
    expect(assistantWithTools.tool_calls).toHaveLength(1);
    expect(assistantWithTools.tool_calls[0].function.name).toBe('calculate');

    // The tool result should come after the assistant message
    const assistantIdx = messages.indexOf(assistantWithTools);
    const toolIdx = messages.findIndex((m: any) => m.role === 'tool');
    expect(toolIdx).toBeGreaterThan(assistantIdx);
  });
});
