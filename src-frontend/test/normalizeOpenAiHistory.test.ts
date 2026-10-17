import { describe, it, expect } from 'vitest';
import { normalizeOpenAiHistory, buildOpenAiChatRequest } from '../services/connections';
import type { Message } from '../services/ollama';

const toolCall = (id: string, name: string, args: unknown = '{}') =>
  ({ id, type: 'function' as const, function: { name, arguments: args } }) as any;

describe('normalizeOpenAiHistory (#579)', () => {
  it('round-trips a single assistant tool turn with its response', () => {
    const out = normalizeOpenAiHistory([
      { role: 'user', content: 'Add 2 and 4.' } as Message,
      {
        role: 'assistant',
        content: 'Calling tool: add_numbers',
        tool_calls: [toolCall('call_1', 'add_numbers', '{"a":2,"b":4}')],
      } as Message,
      { role: 'tool', content: '6', name: 'add_numbers', tool_call_id: 'call_1' } as Message,
      { role: 'user', content: 'thanks' } as Message,
    ]);

    expect(out).toEqual([
      { role: 'user', content: 'Add 2 and 4.' },
      {
        role: 'assistant',
        content: 'Calling tool: add_numbers',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add_numbers', arguments: '{"a":2,"b":4}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '6' },
      { role: 'user', content: 'thanks' },
    ]);
  });

  it('matches a legacy tool message (no tool_call_id) by name (#579)', () => {
    const out = normalizeOpenAiHistory([
      {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall('call_1', 'add_numbers', '[]')],
      } as Message,
      { role: 'tool', content: '6', name: 'add_numbers' } as Message,
    ]);

    expect(out).toEqual([
      { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add_numbers', arguments: '[]' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '6' },
    ]);
  });

  it('matches each parallel tool result to the right call id (#579)', () => {
    const out = normalizeOpenAiHistory([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          toolCall('call-1', 'add_numbers', '{"a":1,"b":1}'),
          toolCall('call-2', 'add_numbers', '{"a":2,"b":2}'),
        ],
      } as Message,
      { role: 'tool', content: '2', name: 'add_numbers', tool_call_id: 'call-1' } as Message,
      { role: 'tool', content: '4', name: 'add_numbers', tool_call_id: 'call-2' } as Message,
    ]);

    const toolMsgs = out.filter((m) => m.role === 'tool');
    const ids = toolMsgs.map((m) => m.tool_call_id);
    expect(ids).toContain('call-1');
    expect(ids).toContain('call-2');
    expect(ids).not.toContain('unknown');
  });

  it('coalesces consecutive assistant tool_calls turns (#579)', () => {
    const out = normalizeOpenAiHistory([
      {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall('call-1', 'web_search', '{"q":"x"}')],
      } as Message,
      {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall('call-2', 'read_file', '{"path":"f"}')],
      } as Message,
      { role: 'tool', content: 'a', name: 'web_search', tool_call_id: 'call-1' } as Message,
      { role: 'tool', content: 'b', name: 'read_file', tool_call_id: 'call-2' } as Message,
    ]);

    const assistants = out.filter((m) => m.role === 'assistant');
    // The two assistant tool_calls turns collapse into one.
    expect(assistants).toHaveLength(1);
    expect(assistants[0].tool_calls).toHaveLength(2);
    // And both results follow.
    const toolMsgs = out.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
  });

  it('stringifies object-valued function.arguments (#579)', () => {
    const out = normalizeOpenAiHistory([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'add_numbers', arguments: { a: 1, b: 2 } } }],
      } as Message,
      { role: 'tool', content: '3', name: 'add_numbers', tool_call_id: 'call-1' } as Message,
    ]);

    const assistant = out.find((m) => m.role === 'assistant') as any;
    expect(typeof assistant.tool_calls[0].function.arguments).toBe('string');
    expect(JSON.parse(assistant.tool_calls[0].function.arguments)).toEqual({ a: 1, b: 2 });
  });

  it('drops a tool message that matches nothing (#579)', () => {
    const out = normalizeOpenAiHistory([
      {
        role: 'assistant',
        content: 'Calling a tool',
        tool_calls: [toolCall('call-1', 'web_search', '[]')],
      } as Message,
      { role: 'tool', content: 'orphan', name: 'web_search', tool_call_id: 'does-not-exist' } as Message,
      { role: 'user', content: 'next' } as Message,
    ]);

    // The orphaned tool message is dropped (never emitted with a fake id),
    // but the human-facing assistant text is kept.
    const toolMsgs = out.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(0);
    const assistants = out.filter((m) => m.role === 'assistant');
    expect(assistants[0].role).toBe('assistant');
    expect(assistants[0].content).toBe('Calling a tool');
  });

  it('drops an assistant tool_calls turn left with zero responses (#579)', () => {
    const out = normalizeOpenAiHistory([
      {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall('call-1', 'web_search', '[]')],
      } as Message,
    ]);

    const toolMsgs = out.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(0);
    // No tool_calls emitted on an unanswered turn.
    const assistants = out.filter((m) => m.role === 'assistant');
    for (const a of assistants) expect(a.tool_calls).toBeUndefined();
  });

  it('passes plain non-tool messages through unchanged', () => {
    const out = normalizeOpenAiHistory([
      { role: 'system', content: 'You are helpful.' } as Message,
      { role: 'user', content: 'hi' } as Message,
    ]);

    expect(out).toEqual([{ role: 'system', content: 'You are helpful.' }, { role: 'user', content: 'hi' }]);
  });

  it('handles an Ollama-dialect tool call (name/arguments at top level) (#579)', () => {
    const out = normalizeOpenAiHistory([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call-1', name: 'add_numbers', arguments: { a: 1, b: 1 } }] as any,
      } as Message,
      { role: 'tool', content: '2', name: 'add_numbers', tool_call_id: 'call-1' } as Message,
    ]);

    const assistant = out.find((m) => m.role === 'assistant') as any;
    expect(assistant.tool_calls[0].function.name).toBe('add_numbers');
    expect(typeof assistant.tool_calls[0].function.arguments).toBe('string');
  });
});

describe('buildOpenAiChatRequest normalizes history (#579)', () => {
  it('normalizes before serializing the wire body', () => {
    const conn = {
      id: 'c',
      name: 'OpenAI',
      kind: 'openai' as const,
      baseUrl: 'http://localhost:1234/',
      enabled: true,
    };

    const req = buildOpenAiChatRequest(conn, 'm', [
      { role: 'user', content: 'go' } as Message,
      {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall('call-1', 'add_numbers', { a: 1, b: 1 })],
      } as Message,
      { role: 'tool', content: '2', name: 'add_numbers', tool_call_id: 'call-1' } as Message,
    ]);

    const body = JSON.parse(req.body) as { messages: any[] };
    const toolMsgs = body.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs[0].tool_call_id).toBe('call-1');
    // Object arguments are stringified on the wire.
    expect(typeof toolMsgs[0].tool_call_id).toBe('string');
  });
});
