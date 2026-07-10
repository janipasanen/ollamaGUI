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

describe('onIteration step progress (#398)', () => {
  it('fires onIteration with (1, max) for a single-turn no-tool reply', async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse([finalLine('hi')])) as never;
    const seen: Array<[number, number]> = [];
    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'hi' }], maxIterations: 7,
      endpoint: 'http://x/api/chat', onIteration: (i, m) => { seen.push([i, m]); },
    });
    for await (const _ of gen) { void _; }
    expect(seen).toEqual([[1, 7]]);
  });

  it('fires onIteration for each loop iteration across tool calls', async () => {
    toolRegistry.registerTool({
      name: 'ping', description: 'ping', parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true }),
    });
    let call = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve(streamResponse([toolCallLine('ping')]));
      return Promise.resolve(streamResponse([finalLine('done')]));
    }) as never;
    const seen: Array<[number, number]> = [];
    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 5,
      endpoint: 'http://x/api/chat', onIteration: (i, m) => { seen.push([i, m]); },
    });
    for await (const _ of gen) { void _; }
    expect(seen).toEqual([[1, 5], [2, 5]]);
  });

  it('does not fire onIteration past maxIterations', async () => {
    // Tool that always re-triggers tool calls so the loop hits the cap.
    toolRegistry.registerTool({
      name: 'loop', description: 'loop', parameters: { type: 'object', properties: {} },
      execute: async () => ({ again: true }),
    });
    let call = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      call++;
      // Every turn returns a tool call — never a final answer.
      return Promise.resolve(streamResponse([toolCallLine('loop')]));
    }) as never;
    const seen: Array<[number, number]> = [];
    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 3,
      endpoint: 'http://x/api/chat', onIteration: (i, m) => { seen.push([i, m]); },
    });
    for await (const _ of gen) { void _; }
    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
  });
});
