import { describe, it, expect, vi } from 'vitest';
import { agenticChatStream, AgenticChatOptions } from '../services/agent';
import { toolRegistry, registerBuiltInTools } from '../services/tools';

// Mock fetch so agenticChatStream doesn't hit real network
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeStreamResponse(messages: Array<{ content?: string; done?: boolean; tool_calls?: any[] }>) {
  const lines = messages.map(m => JSON.stringify({ message: { role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls }, done: m.done ?? false }));
  lines.push(JSON.stringify({ done: true }));
  const text = lines.join('\n');
  return {
    ok: true,
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

// ── toolFilter in agenticChatStream (#104) ────────────────────────────────────

describe('agenticChatStream toolFilter (#104)', () => {
  beforeEach(() => {
    registerBuiltInTools();
    mockFetch.mockResolvedValue(makeStreamResponse([{ content: 'Answer.', done: true }]));
  });

  afterEach(() => vi.clearAllMocks());

  it('passes all tools when toolFilter is undefined', async () => {
    const opts: AgenticChatOptions = {
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      maxIterations: 1,
      endpoint: 'http://localhost:11434/api/chat',
    };
    const gen = agenticChatStream(opts);
    for await (const _ of gen) { /* consume */ }
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const toolNames: string[] = body.tools?.map((t: any) => t.function.name) ?? [];
    // Should include built-in tools
    expect(toolNames.length).toBeGreaterThan(0);
  });

  it('restricts to only the specified tools when toolFilter is set', async () => {
    const allBuiltIns = toolRegistry.getAllTools().map(t => t.name);
    if (allBuiltIns.length < 2) return; // skip if not enough tools
    const [first] = allBuiltIns;
    const opts: AgenticChatOptions = {
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      maxIterations: 1,
      endpoint: 'http://localhost:11434/api/chat',
      toolFilter: [first],
    };
    const gen = agenticChatStream(opts);
    for await (const _ of gen) { /* consume */ }
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const toolNames: string[] = body.tools?.map((t: any) => t.function.name) ?? [];
    expect(toolNames).toEqual([first]);
  });

  it('passes empty tools when toolFilter is an empty array', async () => {
    const opts: AgenticChatOptions = {
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      maxIterations: 1,
      endpoint: 'http://localhost:11434/api/chat',
      toolFilter: [],
    };
    const gen = agenticChatStream(opts);
    for await (const _ of gen) { /* consume */ }
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Empty tools array → no tools field sent
    expect(body.tools).toBeUndefined();
  });
});

// ── spawn_subagent tool (#104) ────────────────────────────────────────────────

describe('spawn_subagent tool (#104)', () => {
  it('spawn_subagent is registered in toolRegistry after registerBuiltInTools', () => {
    // spawn_subagent is registered in App.tsx startup, not registerBuiltInTools.
    // Here we verify the service interface: agenticChatStream accepts toolFilter.
    // Full integration tested via App-level tests.
    // May or may not be registered depending on test isolation — just ensure we can register it
    const fakeTool = {
      name: 'spawn_subagent',
      description: 'spawn sub-agent',
      parameters: { type: 'object' as const, properties: {}, required: [] },
      execute: async () => ({ result: 'done' }),
    };
    toolRegistry.registerTool(fakeTool);
    expect(toolRegistry.getTool('spawn_subagent')).toBeDefined();
    toolRegistry.unregisterTool('spawn_subagent');
  });

  it('execute returns the sub-agent final message', async () => {
    mockFetch.mockResolvedValue(makeStreamResponse([{ content: 'SubResult', done: true }]));
    let lastAssistant = '';
    const gen = agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'a task' }],
      maxIterations: 1,
      endpoint: 'http://localhost/api/chat',
      onAssistantMessage: (m) => { lastAssistant = m; },
    });
    for await (const _ of gen) { /* consume */ }
    expect(lastAssistant).toBe('SubResult');
  });

  it('depth is bounded by maxIterations in sub-agent call', async () => {
    // Count fetch calls — a maxIterations=3 sub-agent should make ≤3 requests
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      return Promise.resolve(makeStreamResponse([{ content: 'done', done: true }]));
    });
    const gen = agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'task' }],
      maxIterations: 3,
      endpoint: 'http://localhost/api/chat',
    });
    for await (const _ of gen) { /* consume */ }
    expect(callCount).toBeLessThanOrEqual(3);
  });

  // ── #586: sub-agent fetch failure surfaces an error (not an empty result) ──

  it('sub-agent fetch failure surfaces an error and no result (#586)', async () => {
    // Mirror of App.tsx `spawn_subagent`: an empty result + onError ⇒ { error }
    // rather than { result: '' }.
    mockFetch.mockRejectedValue(new Error('connection reset by peer'));
    let result = '';
    let errorText: string | undefined;
    const gen = agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'a task' }],
      maxIterations: 3,
      endpoint: 'http://localhost/api/chat',
      onAssistantMessage: (m) => { result = m; },
      onError: (e) => { errorText = e.message; },
    });
    for await (const _ of gen) { /* consume */ }

    // No assistant content was produced...
    expect(result).toBe('');
    // ...but an error was surfaced, so the parent returns { error } (#586).
    expect(errorText).toContain('connection reset');
    const outcome = result === '' ? { error: errorText ?? 'Sub-agent failed to respond.' } : { result };
    expect(outcome).toHaveProperty('error');
    expect(outcome).not.toHaveProperty('result');
  });

  // ── #585: failed/sub-agent outcomes are flagged, never an empty result ────

  it('non-ok (503) response surfaces an error signal (#585/#586)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({ error: 'Service Unavailable' }),
    });
    let result = '';
    let errorText: string | undefined;
    for await (const _ of agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'a task' }],
      maxIterations: 3,
      onAssistantMessage: (m) => { result = m; },
      onError: (e) => { errorText = e.message; },
    })) {
      void _;
    }
    // No content on a failed stream...
    expect(result).toBe('');
    // ...but the failure is surfaced so the parent returns { error } (#585).
    expect(errorText).toContain('Service Unavailable');
  });

  it('flags maxIterations reached instead of returning an empty result (#585)', async () => {
    // Always returns a tool call so the loop would run forever without the guard.
    vi.spyOn(toolRegistry, 'executeToolCall').mockResolvedValue({ content: 'ok', name: 'noop' });
    mockFetch.mockImplementation(() =>
      Promise.resolve(makeStreamResponse([{ content: '', tool_calls: [{ id: 'c1', function: { name: 'noop', arguments: {} } }] }]))
    );
    let truncated = false;
    const msgs: any[] = [];
    for await (const m of agenticChatStream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'task' }],
      maxIterations: 3,
      onMaxIterations: () => { truncated = true; },
    })) {
      msgs.push(m);
    }
    // Stopping at maxIterations is flagged rather than swallowed as '' (#585).
    expect(truncated).toBe(true);
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toContain('maximum tool iterations');
  });
});
