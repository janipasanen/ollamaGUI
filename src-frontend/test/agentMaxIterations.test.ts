/**
 * Agentic "Continue past max-iterations" (#403): the agent loop fires
 * `onMaxIterations` exactly once when it exhausts maxIterations without a
 * final answer, and yields a max-iterations warning message.
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

beforeEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
});
afterEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
});

describe('onMaxIterations callback (#403)', () => {
  it('fires onMaxIterations once when the loop hits the cap with no final answer', async () => {
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

    let fired = 0;
    const yielded: string[] = [];
    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 3,
      endpoint: 'http://x/api/chat',
      onMaxIterations: () => { fired++; },
    });
    for await (const m of gen) { yielded.push(m.content); }

    expect(call).toBe(3);
    expect(fired).toBe(1);
    expect(yielded.some(c => c.includes('maximum tool iterations'))).toBe(true);
  });

  it('does not fire onMaxIterations when a final answer is produced within the cap', async () => {
    toolRegistry.registerTool({
      name: 'ping', description: 'ping', parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true }),
    });
    let call = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve(streamResponse([toolCallLine('ping')]));
      return Promise.resolve(streamResponse([JSON.stringify({ message: { role: 'assistant', content: 'done' }, done: true })]));
    }) as never;

    let fired = 0;
    const gen = agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 5,
      endpoint: 'http://x/api/chat',
      onMaxIterations: () => { fired++; },
    });
    for await (const _ of gen) { void _; }
    expect(fired).toBe(0);
  });
});
