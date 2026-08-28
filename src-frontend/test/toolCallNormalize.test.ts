/**
 * G6 — provider-tolerant tool-call normalization.
 *
 * Verifies normalizeToolCall accepts both the OpenAI-compatible and Ollama-
 * native shapes, rejects empty/partial fragments, and never throws. Also
 * checks the tolerant helper delegation (toolCallName / toolCallArgs) and that
 * a ToolCall with missing function shape round-trips.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeToolCall,
  toolCallName,
  toolCallArgs,
  type ToolCall,
} from '../services/tools';

describe('normalizeToolCall — openai-compatible shape', () => {
  it('parses { id, function: { name, arguments } } with a JSON string', () => {
    const raw = {
      id: 'call_1',
      type: 'function',
      function: { name: 'run_shell_command', arguments: '{"command":"ls"}' },
    };
    const call = normalizeToolCall(raw);
    expect(call).not.toBeNull();
    expect(call?.id).toBe('call_1');
    expect(call?.function?.name).toBe('run_shell_command');
    expect(toolCallArgs(call!)).toEqual({ command: 'ls' });
  });

  it('accepts arguments given as an already-parsed object', () => {
    const raw = {
      id: 'call_2',
      function: { name: 'read_file', arguments: { path: '/a/b' } },
    };
    const call = normalizeToolCall(raw);
    expect(call?.function?.name).toBe('read_file');
    expect(toolCallArgs(call!)).toEqual({ path: '/a/b' });
  });
});

describe('normalizeToolCall — ollama-native shape', () => {
  it('parses { name, arguments } without a nested function', () => {
    const raw = { name: 'run_shell_command', arguments: '{"command":"echo hi"}' };
    const call = normalizeToolCall(raw);
    expect(call?.name).toBe('run_shell_command');
    expect(toolCallArgs(call!)).toEqual({ command: 'echo hi' });
  });

  it('parses { id, function: { name } } with top-level arguments', () => {
    const raw = { id: 'abc', function: { name: 'read_file' }, arguments: '{"path":"x"}' };
    const call = normalizeToolCall(raw);
    expect(call?.id).toBe('abc');
    expect(call?.function?.name).toBe('read_file');
  });
});

describe('normalizeToolCall — rejects empty / malformed input', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['number', 42],
    ['string', 'not an object'],
    ['empty object', {}],
    ['name-only fragment (no args)', { function: { name: 'read_file' } }],
    ['function-name-only no arguments', { name: 'read_file' }],
    ['empty tool_calls item', { id: 'x' }],
  ])('returns null for %s', (_label, raw) => {
    expect(normalizeToolCall(raw)).toBeNull();
  });

  it('never throws on a broken object', () => {
    expect(() => normalizeToolCall({ function: 5, name: 7 })).not.toThrow();
    expect(normalizeToolCall({ function: 5 })).toBeNull();
  });
});

describe('normalizeToolCall — round-trip via helper delegation', () => {
  it('toolCallName and toolCallArgs delegate to the normalized result', () => {
    const call: ToolCall = {
      id: 'c1',
      type: 'function',
      function: { name: 'run_shell_command', arguments: '{"a":1}' },
    };
    // The helper functions should accept either the raw or normalized shape.
    expect(toolCallName(normalizeToolCall(call))).toBe('run_shell_command');
    expect(toolCallArgs(normalizeToolCall(call))).toEqual({ a: 1 });
  });

  it('a normalized call whose arguments string is malformed returns {} (no throw)', () => {
    const raw = { id: 'c', function: { name: 'run_shell_command', arguments: '{not json' } };
    const call = normalizeToolCall(raw);
    expect(toolCallArgs(call!)).toEqual({});
  });
});
