import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolRegistry, truncateToolContent, MAX_TOOL_OUTPUT_CHARS } from '../services/tools';
import { agenticChatStream } from '../services/agent';
import {
  registerPostToolUseHook, removePostToolUseHook, clearPostToolUseHooks,
  listPostToolUseHookIds, runPostToolUseHooks, makeRedactHook,
} from '../services/toolHooks';

/** Build a streaming Ollama response from an array of NDJSON lines. */
function streamResponse(lines: string[]) {
  const text = lines.join('\n') + '\n';
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

function toolCallLine(name: string, args: Record<string, unknown> = {}, id = 'call-1') {
  return JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } });
}

function finalLine(content: string) {
  return JSON.stringify({ message: { role: 'assistant', content }, done: true });
}

beforeEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
  clearPostToolUseHooks();
});

afterEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
  clearPostToolUseHooks();
});

// ── #395 PostToolUse hooks — unit ─────────────────────────────────────────────

describe('PostToolUse hooks (#395)', () => {
  it('register/remove/clear lifecycle', () => {
    registerPostToolUseHook('h1', () => ({ action: 'allow' }));
    expect(listPostToolUseHookIds()).toContain('h1');
    removePostToolUseHook('h1');
    expect(listPostToolUseHookIds()).not.toContain('h1');
    registerPostToolUseHook('h2', () => ({ action: 'allow' }));
    clearPostToolUseHooks();
    expect(listPostToolUseHookIds()).toHaveLength(0);
  });

  it('allows unchanged when no hooks', async () => {
    const r = await runPostToolUseHooks('read_file', { path: 'a' }, 'hello');
    expect(r.blocked).toBe(false);
    expect(r.content).toBe('hello');
  });

  it('transform replaces content', async () => {
    registerPostToolUseHook('upper', (_n, _a, content) => ({ action: 'transform', content: content.toUpperCase() }));
    const r = await runPostToolUseHooks('t', {}, 'abc');
    expect(r.blocked).toBe(false);
    expect(r.content).toBe('ABC');
  });

  it('block short-circuits and returns reason', async () => {
    registerPostToolUseHook('blocker', () => ({ action: 'block', reason: 'nope' }));
    registerPostToolUseHook('after', () => ({ action: 'transform', content: 'should not run' }));
    const r = await runPostToolUseHooks('t', {}, 'orig');
    expect(r.blocked).toBe(true);
    expect(r.content).toBe('nope');
    expect(r.reason).toBe('nope');
  });

  it('makeRedactHook redacts secrets', async () => {
    registerPostToolUseHook('redact', makeRedactHook('SECRET'));
    const r = await runPostToolUseHooks('run_shell_command', {}, 'token=SECRET end');
    expect(r.content).toBe('token=[REDACTED] end');
    expect(r.blocked).toBe(false);
  });

  it('makeRedactHook passes through when secret absent', async () => {
    const hook = makeRedactHook('SECRET');
    expect((await hook('t', {}, 'nothing here')).action).toBe('allow');
  });
});

// ── #396 tool-output truncation — unit ────────────────────────────────────────

describe('truncateToolContent (#396)', () => {
  it('passes short content through', () => {
    expect(truncateToolContent('short')).toBe('short');
  });

  it('truncates overlong content with a notice', () => {
    const big = 'A'.repeat(MAX_TOOL_OUTPUT_CHARS + 5000);
    const out = truncateToolContent(big);
    expect(out.length).toBeLessThan(big.length);
    expect(out.startsWith('A'.repeat(MAX_TOOL_OUTPUT_CHARS))).toBe(true);
    expect(out).toContain('output truncated');
    expect(out).toContain('5000 chars omitted');
  });

  it('respects a custom limit', () => {
    expect(truncateToolContent('abcdefgh', 4)).toBe('abcd\n…[output truncated: 4 chars omitted]');
  });
});

// ── Integration: agent loop feeds post-hooked + truncated content to the model ─

describe('agent loop model-context shaping (#395/#396)', () => {
  it('truncates huge tool output in the model context but keeps full output in UI', async () => {
    const huge = 'X'.repeat(MAX_TOOL_OUTPUT_CHARS + 10000);
    toolRegistry.registerTool({
      name: 'big_tool',
      description: 'returns a huge string',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ data: huge }),
    });

    const fetchMock = vi.fn();
    let call = 0;
    fetchMock.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve(streamResponse([toolCallLine('big_tool')]));
      return Promise.resolve(streamResponse([finalLine('done')]));
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const yielded: { role: string; content: string; name?: string }[] = [];
    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 2,
      endpoint: 'http://x/api/chat',
    });
    for await (const m of gen) yielded.push(m as never);

    // UI (yielded) tool message keeps the full output.
    const uiTool = yielded.find(m => m.role === 'tool' && m.name === 'big_tool')!;
    expect(uiTool.content).toContain(huge.slice(0, 50));

    // Model context (2nd request body) tool message is truncated.
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const ctxTool = secondBody.messages.find((m: any) => m.role === 'tool' && m.name === 'big_tool');
    expect(ctxTool).toBeDefined();
    expect(ctxTool.content.length).toBeLessThan(huge.length);
    expect(ctxTool.content).toContain('output truncated');
  });

  it('post-hook redacts secrets in the model context but not in the UI', async () => {
    toolRegistry.registerTool({
      name: 'leak_tool',
      description: 'returns a secret',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ token: 'TOKEN=SECRET123' }),
    });
    registerPostToolUseHook('redact', makeRedactHook('SECRET123'));

    const fetchMock = vi.fn();
    let call = 0;
    fetchMock.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve(streamResponse([toolCallLine('leak_tool')]));
      return Promise.resolve(streamResponse([finalLine('ok')]));
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const yielded: { role: string; content: string; name?: string }[] = [];
    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 2,
      endpoint: 'http://x/api/chat',
    });
    for await (const m of gen) yielded.push(m as never);

    const uiTool = yielded.find(m => m.role === 'tool' && m.name === 'leak_tool')!;
    expect(uiTool.content).toContain('SECRET123');

    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const ctxTool = secondBody.messages.find((m: any) => m.role === 'tool' && m.name === 'leak_tool');
    expect(ctxTool.content).not.toContain('SECRET123');
    expect(ctxTool.content).toContain('[REDACTED]');
  });
});
