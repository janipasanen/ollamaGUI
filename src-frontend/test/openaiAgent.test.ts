/**
 * OpenAI-compatible agentic loop (#551) — LM Studio / Qwen coder support.
 * The SSE fixtures replay byte-for-byte what LM Studio 0.3.x returned for
 * qwen/qwen3-coder-next against a live server (2026-08-21 capture).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openaiAgenticChatStream, makeThinkFilter, toOpenAiMessages } from '../services/openaiAgent';
import { toolRegistry } from '../services/tools';

const CONN = { baseUrl: 'http://172.16.222.168:1234', apiKey: undefined };

function sse(frames: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: () => i < frames.length
          ? Promise.resolve({ done: false, value: encoder.encode(frames[i++] + '\n\n') })
          : Promise.resolve({ done: true, value: undefined }),
      }),
    },
  };
}

// Live-captured LM Studio frames: id+name first, arguments in a later
// fragment, finish_reason on an empty delta.
const TOOLCALL_FRAMES = [
  'data: {"choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"IbyXkhlpZ4wSmVMd1Cz7n3HFwUcPKKih","type":"function","function":{"name":"list_dir","arguments":""}}]},"finish_reason":null}]}',
  'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"type":"function","function":{"arguments":"{\\"path\\":\\"src\\"}"}}]},"finish_reason":null}]}',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
  'data: [DONE]',
];
const FINAL_FRAMES = [
  'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"The files are "},"finish_reason":null}]}',
  'data: {"choices":[{"index":0,"delta":{"content":"main.rs and lib.rs."},"finish_reason":"stop"}]}',
  'data: [DONE]',
];

beforeEach(() => {
  localStorage.clear();
  toolRegistry.registerTool({
    name: 'list_dir', description: 'List files', readOnly: true,
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] },
    execute: async (params: Record<string, unknown>) => ({ files: ['main.rs', 'lib.rs'], path: params.path }),
  });
});
afterEach(() => toolRegistry.unregisterTool('list_dir'));

describe('makeThinkFilter (#551)', () => {
  it('routes <think> spans to reasoning, split-tag-safe across chunks', () => {
    const f = makeThinkFilter();
    let content = '', reasoning = '';
    for (const d of ['Hello <thi', 'nk>secret plan</th', 'ink> world']) {
      const r = f(d);
      content += r.content; reasoning += r.reasoning;
    }
    expect(content).toBe('Hello  world');
    expect(reasoning).toBe('secret plan');
  });

  it('passes plain content through untouched', () => {
    const f = makeThinkFilter();
    expect(f('no tags here').content).toBe('no tags here');
  });
});

describe('toOpenAiMessages (#551)', () => {
  it('maps tool results with tool_call_id and stringifies tool-call arguments', () => {
    const out = toOpenAiMessages([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', function: { name: 'list_dir', arguments: { path: 'src' } } }] },
      { role: 'tool', content: 'main.rs', name: 'list_dir', tool_call_id: 'call_1' },
    ] as any);
    expect(out[1].content).toBeNull();
    expect(out[1].tool_calls[0].function.arguments).toBe('{"path":"src"}');
    expect(out[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'main.rs' });
  });
});

describe('openaiAgenticChatStream (#551) — live-captured LM Studio dialect', () => {
  it('accumulates fragmented tool calls, executes, round-trips, and finishes', async () => {
    const bodies: any[] = [];
    global.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(sse(bodies.length === 1 ? TOOLCALL_FRAMES : FINAL_FRAMES));
    }) as unknown as typeof fetch;

    const toolCalls: string[] = [];
    const toolResults: string[] = [];
    let finalMessage = '';
    const yielded: any[] = [];
    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen/qwen3-coder-next',
      messages: [{ role: 'user', content: 'list src' }],
      maxIterations: 4,
      toolFilter: ['list_dir'],
      onToolCall: tc => toolCalls.push(JSON.stringify(tc)),
      onToolResult: tr => toolResults.push(tr.content),
      onAssistantMessage: m => { finalMessage = m; },
    });
    for await (const m of gen) yielded.push(m);

    // The fragmented arguments were reassembled and parsed for execution.
    expect(toolCalls[0]).toContain('list_dir');
    expect(toolResults[0]).toContain('main.rs');
    // Second request carried the assistant tool-call turn + the tool result
    // with the server-issued id round-tripped.
    expect(bodies[1].messages.at(-2).tool_calls[0].id).toBe('IbyXkhlpZ4wSmVMd1Cz7n3HFwUcPKKih');
    expect(bodies[1].messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'IbyXkhlpZ4wSmVMd1Cz7n3HFwUcPKKih' });
    // Tools were offered in the OpenAI schema on both requests.
    expect(bodies[0].tools[0].type).toBe('function');
    expect(finalMessage).toBe('The files are main.rs and lib.rs.');
    expect(yielded.at(-1).role).toBe('assistant');
  });

  it('stops with the load-bearing max-iterations prefix', async () => {
    // Fresh stream per request — a reused reader is already exhausted.
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(sse(TOOLCALL_FRAMES))) as unknown as typeof fetch;
    const yielded: any[] = [];
    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen/qwen3-coder-next',
      messages: [{ role: 'user', content: 'loop forever' }],
      maxIterations: 2,
      toolFilter: ['list_dir'],
    });
    for await (const m of gen) yielded.push(m);
    expect(yielded.at(-1).content).toMatch(/^⚠️ Agent stopped: maximum tool iterations \(2\)/);
  });

  it('surfaces <think> content as reasoning, not chat text', async () => {
    const THINK_FRAMES = [
      'data: {"choices":[{"index":0,"delta":{"content":"<think>check the tree</think>Answer: "},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"content":"two files."},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ];
    global.fetch = vi.fn().mockResolvedValue(sse(THINK_FRAMES)) as unknown as typeof fetch;
    let reasoning = '';
    let content = '';
    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen/qwen3-coder-next',
      messages: [{ role: 'user', content: 'how many files?' }],
      onAssistantReasoning: r => { reasoning = r; },
      onAssistantMessage: m => { content = m; },
    });
    for await (const _m of gen) { /* consume */ }
    expect(reasoning).toBe('check the tree');
    expect(content).toBe('Answer: two files.');
  });
});

describe('openaiAgenticChatStream (#551) — Qwen content-channel tool calls', () => {
  // LM Studio streaming Qwen3-Coder: the call arrives as XML in `content`,
  // never in `delta.tool_calls` (lmstudio-bug-tracker#1071).
  const XML_FRAMES = [
    'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"Let me check.\\n<tool_"},"finish_reason":null}]}',
    'data: {"choices":[{"index":0,"delta":{"content":"call>\\n<function=list_dir>\\n<parameter=path>\\nsrc\\n</parameter>\\n</fun"},"finish_reason":null}]}',
    'data: {"choices":[{"index":0,"delta":{"content":"ction>\\n</tool_call>"},"finish_reason":"stop"}]}',
    'data: [DONE]',
  ];

  it('recovers the XML call, executes it, and round-trips a real tool_call_id', async () => {
    const bodies: any[] = [];
    global.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(sse(bodies.length === 1 ? XML_FRAMES : FINAL_FRAMES));
    }) as unknown as typeof fetch;

    const toolResults: string[] = [];
    const seenContent: string[] = [];
    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen/qwen3-coder-next',
      messages: [{ role: 'user', content: 'list src' }],
      maxIterations: 4,
      toolFilter: ['list_dir'],
      onToolResult: tr => toolResults.push(tr.content),
      onAssistantMessage: m => seenContent.push(m),
    });
    for await (const _m of gen) { /* consume */ }

    expect(toolResults[0]).toContain('main.rs');
    // The recovered call's id is echoed on the tool result, so strict servers
    // (LM Studio, vLLM) accept the follow-up request.
    const call = bodies[1].messages.at(-2).tool_calls[0];
    expect(call.function.name).toBe('list_dir');
    expect(JSON.parse(call.function.arguments)).toEqual({ path: 'src' });
    expect(bodies[1].messages.at(-1).tool_call_id).toBe(call.id);
    // Raw markup must never reach the chat bubble — not even mid-stream,
    // where the tag straddles three chunks.
    expect(seenContent.every(c => !c.includes('<tool_call>') && !c.includes('<function='))).toBe(true);
    expect(seenContent[0]).toBe('Let me check.\n');
  });

  it('prefers native tool_calls and does not double-count a content copy', async () => {
    const BOTH = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"<tool_call>\\n<function=list_dir>\\n<parameter=path>\\nsrc\\n</parameter>\\n</function>\\n</tool_call>","tool_calls":[{"index":0,"id":"native_1","type":"function","function":{"name":"list_dir","arguments":"{\\"path\\":\\"src\\"}"}}]},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ];
    const bodies: any[] = [];
    global.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(sse(bodies.length === 1 ? BOTH : FINAL_FRAMES));
    }) as unknown as typeof fetch;

    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen/qwen3-coder-next',
      messages: [{ role: 'user', content: 'list src' }],
      maxIterations: 4, toolFilter: ['list_dir'],
    });
    for await (const _m of gen) { /* consume */ }
    expect(bodies[1].messages.at(-2).tool_calls).toHaveLength(1);
    expect(bodies[1].messages.at(-2).tool_calls[0].id).toBe('native_1');
  });

  it('treats LM Studio\'s empty tool_calls array as an ordinary chat turn', async () => {
    // LM Studio attaches `tool_calls: []` to every response; taking that as
    // "a tool is coming" is what hangs opencode (opencode#4255).
    const EMPTY = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"Hello!","tool_calls":[]},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[]},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ];
    const bodies: any[] = [];
    global.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(sse(EMPTY));
    }) as unknown as typeof fetch;

    const yielded: any[] = [];
    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen/qwen3-coder-next',
      messages: [{ role: 'user', content: 'hi' }],
      maxIterations: 4, toolFilter: ['list_dir'],
    });
    for await (const m of gen) yielded.push(m);
    expect(bodies).toHaveLength(1);          // no second round-trip
    expect(yielded).toHaveLength(1);
    expect(yielded[0]).toMatchObject({ role: 'assistant', content: 'Hello!' });
  });

  it('feeds a failing tool back to the model instead of killing the run', async () => {
    const BAD = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"no_such_tool","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ];
    const bodies: any[] = [];
    global.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(sse(bodies.length === 1 ? BAD : FINAL_FRAMES));
    }) as unknown as typeof fetch;

    const errors: string[] = [];
    let finalMessage = '';
    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen/qwen3-coder-next',
      messages: [{ role: 'user', content: 'go' }],
      maxIterations: 4,
      onError: e => errors.push(e.message),
      onAssistantMessage: m => { finalMessage = m; },
    });
    for await (const _m of gen) { /* consume */ }

    expect(errors).toEqual([]);                              // run survived
    expect(bodies[1].messages.at(-1).content).toMatch(/^Error: /);
    expect(finalMessage).toBe('The files are main.rs and lib.rs.');
  });
});

describe('openaiAgenticChatStream (#551) — malformed arguments from local builds', () => {
  it('names the parse failure instead of silently calling the tool with no arguments', async () => {
    // llama.cpp / LM Studio truncate argument JSON at the token limit.
    const TRUNCATED = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"list_dir","arguments":"{\\"path\\": \\"sr"}}]},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ];
    const bodies: any[] = [];
    global.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(sse(bodies.length === 1 ? TRUNCATED : FINAL_FRAMES));
    }) as unknown as typeof fetch;

    const results: string[] = [];
    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen/qwen3-coder-next',
      messages: [{ role: 'user', content: 'list src' }],
      maxIterations: 4, toolFilter: ['list_dir'],
      onToolResult: tr => results.push(tr.content),
    });
    for await (const _m of gen) { /* consume */ }

    expect(results[0]).toMatch(/could not parse the arguments/);
    // The run continues so the model can re-issue the call.
    expect(bodies).toHaveLength(2);
  });

  it('still accepts an empty argument string for a no-parameter tool', async () => {
    const NO_ARGS = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"list_dir","arguments":""}}]},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ];
    const bodies: any[] = [];
    global.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(sse(bodies.length === 1 ? NO_ARGS : FINAL_FRAMES));
    }) as unknown as typeof fetch;

    const results: string[] = [];
    const gen = openaiAgenticChatStream({
      conn: CONN, model: 'qwen/qwen3-coder-next',
      messages: [{ role: 'user', content: 'list' }],
      maxIterations: 4, toolFilter: ['list_dir'],
      onToolResult: tr => results.push(tr.content),
    });
    for await (const _m of gen) { /* consume */ }
    expect(results[0]).toContain('main.rs');
  });
});
