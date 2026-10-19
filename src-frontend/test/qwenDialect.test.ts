/**
 * Qwen content-channel tool-call recovery (#551).
 *
 * LM Studio serves Qwen3-Coder with the model's own chat template, which emits
 * tool calls as XML in the content channel and — in streaming mode — is not
 * re-parsed back into `delta.tool_calls` (lmstudio-bug-tracker#1071). These
 * cover both wire dialects we recover from.
 */
import { describe, it, expect } from 'vitest';
import { parseQwenToolCalls, coerceParamValue, makeQwenStreamFilter } from '../services/qwenDialect';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          start_line: { type: 'number' },
          verbose: { type: 'boolean' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_plan',
      description: 'Record a plan',
      parameters: {
        type: 'object',
        properties: { steps: { type: 'array', items: { type: 'object' } } },
        required: ['steps'],
      },
    },
  },
];

const args = (c: any) => JSON.parse(c.function.arguments);

describe('coerceParamValue (#551)', () => {
  it('strips the template newlines and honours the declared type', () => {
    expect(coerceParamValue('\nsrc/lib.rs\n', { type: 'string' })).toBe('src/lib.rs');
    expect(coerceParamValue('\n42\n', { type: 'number' })).toBe(42);
    expect(coerceParamValue('\ntrue\n', { type: 'boolean' })).toBe(true);
    expect(coerceParamValue('\n[1,2]\n', { type: 'array' })).toEqual([1, 2]);
  });

  it('leaves the raw string alone when the schema is unknown or the value does not fit', () => {
    // Guessing here would turn a version string into the number 1.
    expect(coerceParamValue('\n1.0\n', undefined)).toBe('1.0');
    expect(coerceParamValue('\nabc\n', { type: 'number' })).toBe('abc');
  });

  it('keeps interior newlines — only the template line breaks are punctuation', () => {
    expect(coerceParamValue('\nline1\nline2\n', { type: 'string' })).toBe('line1\nline2');
  });
});

describe('parseQwenToolCalls — Qwen3-Coder XML dialect (#551)', () => {
  it('recovers a call and removes the block from the visible content', () => {
    const content = 'Let me look.\n<tool_call>\n<function=read_file>\n<parameter=path>\nsrc/lib.rs\n</parameter>\n<parameter=start_line>\n10\n</parameter>\n</function>\n</tool_call>\n';
    const { calls, cleanedContent } = parseQwenToolCalls(content, TOOLS);
    expect(calls).toHaveLength(1);
    expect(calls[0].function!.name).toBe('read_file');
    expect(args(calls[0])).toEqual({ path: 'src/lib.rs', start_line: 10 });
    expect(cleanedContent).not.toContain('<tool_call>');
    expect(cleanedContent.trim()).toBe('Let me look.');
  });

  it('recovers several calls in one turn with distinct ids', () => {
    const content =
      '<tool_call>\n<function=read_file>\n<parameter=path>\na.ts\n</parameter>\n</function>\n</tool_call>' +
      '<tool_call>\n<function=read_file>\n<parameter=path>\nb.ts\n</parameter>\n</function>\n</tool_call>';
    const { calls } = parseQwenToolCalls(content, TOOLS);
    expect(calls.map(c => args(c).path)).toEqual(['a.ts', 'b.ts']);
    expect(new Set(calls.map(c => c.id)).size).toBe(2);
  });

  it('parses a nested array-of-objects parameter', () => {
    const steps = [{ step: 'read', status: 'pending' }];
    const content = `<tool_call>\n<function=update_plan>\n<parameter=steps>\n${JSON.stringify(steps)}\n</parameter>\n</function>\n</tool_call>`;
    const { calls } = parseQwenToolCalls(content, TOOLS);
    expect(args(calls[0])).toEqual({ steps });
  });

  it('accepts the bare <name>value</name> parameter variant some repacked templates emit', () => {
    const content = '<tool_call>\n<function=read_file>\n<path>src/main.rs</path>\n</function>\n</tool_call>';
    const { calls } = parseQwenToolCalls(content, TOOLS);
    expect(args(calls[0])).toEqual({ path: 'src/main.rs' });
  });
});

describe('parseQwenToolCalls — Qwen2.5/Qwen3 JSON dialect (#551)', () => {
  it('recovers a JSON payload wrapped in tool_call tags', () => {
    const content = '<tool_call>\n{"name": "read_file", "arguments": {"path": "src/lib.rs"}}\n</tool_call>';
    const { calls, cleanedContent } = parseQwenToolCalls(content, TOOLS);
    expect(calls[0].function!.name).toBe('read_file');
    expect(args(calls[0])).toEqual({ path: 'src/lib.rs' });
    expect(cleanedContent.trim()).toBe('');
  });
});

describe('parseQwenToolCalls — safety (#551)', () => {
  it('leaves a block naming an undeclared tool as visible text', () => {
    // A model explaining the format must not have its example executed.
    const content = 'For example:\n<tool_call>\n<function=rm_rf>\n<parameter=path>\n/\n</parameter>\n</function>\n</tool_call>';
    const { calls, cleanedContent } = parseQwenToolCalls(content, TOOLS);
    expect(calls).toHaveLength(0);
    expect(cleanedContent).toContain('<function=rm_rf>');
  });

  it('leaves an unparseable block as visible text', () => {
    const content = '<tool_call>\nnot xml and not json\n</tool_call>';
    const { calls, cleanedContent } = parseQwenToolCalls(content, TOOLS);
    expect(calls).toHaveLength(0);
    expect(cleanedContent).toContain('not xml and not json');
  });

  it('is a no-op on content with no tool_call markup', () => {
    const { calls, cleanedContent } = parseQwenToolCalls('just prose', TOOLS);
    expect(calls).toHaveLength(0);
    expect(cleanedContent).toBe('just prose');
  });

  it('accepts any name when no tool list is supplied', () => {
    const content = '<tool_call>\n<function=anything>\n<parameter=x>\n1\n</parameter>\n</function>\n</tool_call>';
    expect(parseQwenToolCalls(content).calls).toHaveLength(1);
  });
});

describe('makeQwenStreamFilter — channel routing (#551)', () => {
  const drive = (deltas: string[], opts?: { captureToolCalls?: boolean }) => {
    const f = makeQwenStreamFilter(opts);
    let content = '', reasoning = '';
    for (const d of deltas) {
      const r = f.push(d);
      content += r.content; reasoning += r.reasoning;
    }
    const tail = f.flush();
    return { content: content + tail.content, reasoning: reasoning + tail.reasoning, tools: f.toolCallText() };
  };

  it('captures tool calls off the visible channel by default', () => {
    const r = drive(['before <tool_call>', '<function=x>', '</function></tool_call> after']);
    expect(r.content).toBe('before  after');
    expect(r.tools).toBe('<tool_call><function=x></function></tool_call>');
  });

  it('leaves tool-call markup in content when capture is off', () => {
    // Callers that never read toolCallText() must opt out, or the markup is
    // deleted from the reply rather than merely hidden.
    const r = drive(['before <tool_call><function=x></function></tool_call> after'], { captureToolCalls: false });
    expect(r.content).toBe('before <tool_call><function=x></function></tool_call> after');
    expect(r.tools).toBe('');
  });

  it('still splits <think> when tool capture is off', () => {
    const r = drive(['<think>plan</think>answer'], { captureToolCalls: false });
    expect(r.reasoning).toBe('plan');
    expect(r.content).toBe('answer');
  });

  it('flushes a trailing partial tag rather than swallowing it', () => {
    expect(drive(['done <']).content).toBe('done <');
    expect(drive(['done <thi']).content).toBe('done <thi');
  });

  it('surfaces an unterminated tool call instead of dropping the turn', () => {
    // Generation cut off at the token limit mid-call.
    const r = drive(['text <tool_call><function=x>']);
    expect(r.content).toContain('<tool_call>');
    expect(r.tools).toBe('');
  });
});
