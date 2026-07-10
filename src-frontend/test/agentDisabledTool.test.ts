/**
 * Per-tool disable enforcement at execution time (#423): a tool excluded from
 * the active `toolFilter` must not execute even if the model returns a call to
 * it (e.g. a hallucination). The filter only removes tools from the request;
 * the loop also blocks execution.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolRegistry } from '../services/tools';
import { agenticChatStream } from '../services/agent';

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

const toolCallLine = (name: string) =>
  JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: '{}' } }] } });
const finalLine = (content: string) => JSON.stringify({ message: { role: 'assistant', content }, done: true });

beforeEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
});
afterEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
});

describe('Disabled-tool execution blocking (#423)', () => {
  it('blocks a tool call that is not in the active toolFilter', async () => {
    let enabledExecuted = 0;
    let disabledExecuted = 0;
    toolRegistry.registerTool({
      name: 'enabled_tool', description: 'enabled', parameters: { type: 'object', properties: {} },
      execute: async () => { enabledExecuted++; return { ok: true }; },
    });
    toolRegistry.registerTool({
      name: 'disabled_tool', description: 'disabled', parameters: { type: 'object', properties: {} },
      execute: async () => { disabledExecuted++; return { ok: true }; },
    });

    let call = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      call++;
      // First turn: the model (hallucinates) the disabled tool. Second: final answer.
      if (call === 1) return Promise.resolve(streamResponse([toolCallLine('disabled_tool')]));
      return Promise.resolve(streamResponse([finalLine('done')]));
    }) as never;

    const toolResults: string[] = [];
    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 5,
      endpoint: 'http://x/api/chat',
      // Only enabled_tool is exposed to the model; disabled_tool is excluded.
      toolFilter: ['enabled_tool'],
      onToolResult: (r) => { toolResults.push(r.content); },
    });
    for await (const _ of gen) { void _; }

    expect(disabledExecuted).toBe(0);
    expect(toolResults.some(c => c.includes('disabled by the user'))).toBe(true);
  });

  it('still executes tools that are in the toolFilter', async () => {
    let enabledExecuted = 0;
    toolRegistry.registerTool({
      name: 'enabled_tool', description: 'enabled', parameters: { type: 'object', properties: {} },
      execute: async () => { enabledExecuted++; return { ok: true }; },
    });

    let call = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve(streamResponse([toolCallLine('enabled_tool')]));
      return Promise.resolve(streamResponse([finalLine('done')]));
    }) as never;

    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 5,
      endpoint: 'http://x/api/chat', toolFilter: ['enabled_tool'],
    });
    for await (const _ of gen) { void _; }
    expect(enabledExecuted).toBe(1);
  });

  it('does not block when no toolFilter is active (all tools allowed)', async () => {
    let executed = 0;
    toolRegistry.registerTool({
      name: 'any_tool', description: 'any', parameters: { type: 'object', properties: {} },
      execute: async () => { executed++; return { ok: true }; },
    });
    let call = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve(streamResponse([toolCallLine('any_tool')]));
      return Promise.resolve(streamResponse([finalLine('done')]));
    }) as never;

    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 5,
      endpoint: 'http://x/api/chat',
    });
    for await (const _ of gen) { void _; }
    expect(executed).toBe(1);
  });
});
