import { describe, it, expect } from 'vitest';
import {
  parseToolArgs,
  parseToolResult,
  isStructuredTool,
  renderAsStructured,
  compactPreview,
  prettyPrint,
  prettyLineCount,
  topLevelRows,
  isToolError,
  STATUS_LABEL,
  type ToolStatus,
} from '../services/toolFormatting';

describe('toolFormatting — argument parsing (#657)', () => {
  it('parses .function.arguments JSON into an object', () => {
    const parsed = parseToolArgs({ function: { arguments: '{"n": 3}' } });
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual({ n: 3 });
  });

  it('parses raw .arguments too', () => {
    const parsed = parseToolArgs({ arguments: '{"q":"hi"}' });
    expect(parsed.value).toEqual({ q: 'hi' });
  });

  it('accepts an already-parsed object argument', () => {
    const parsed = parseToolArgs({ function: { arguments: { a: 1 } } });
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual({ a: 1 });
  });

  it('falls back to raw text for non-JSON arguments', () => {
    const parsed = parseToolArgs({ function: { arguments: 'not json' } });
    expect(parsed.ok).toBe(false);
    expect(parsed.value).toBe('not json');
  });
});

describe('toolFormatting — result parsing (#657)', () => {
  it('parses a JSON result', () => {
    const parsed = parseToolResult('{"time":"12:00"}');
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual({ time: '12:00' });
  });

  it('reports failure for non-JSON result', () => {
    const parsed = parseToolResult('just text');
    expect(parsed.ok).toBe(false);
    expect(parsed.value).toBe('just text');
  });

  it('flags error / blocked content', () => {
    expect(isToolError('error: timeout')).toBe(true);
    expect(isToolError('Tool blocked: read-only mode active')).toBe(true);
    expect(isToolError('{"ok":true}')).toBe(false);
  });
});

describe('toolFormatting — structured detection (#657)', () => {
  it('treats known structured tools as structured regardless of payload', () => {
    expect(isStructuredTool('calculate')).toBe(true);
    expect(isStructuredTool('get_current_time')).toBe(true);
    expect(isStructuredTool('execute_command')).toBe(false);
  });

  it('renders structured when a result parses as a JSON object/array', () => {
    expect(renderAsStructured('execute', parseToolResult('[1,2,3]'))).toBe(true);
    expect(renderAsStructured('execute', parseToolResult('"hello"'))).toBe(false);
    expect(renderAsStructured('calculate', parseToolResult('"42"'))).toBe(true); // structured tool name wins
  });
});

describe('toolFormatting — preview + pretty print (#657)', () => {
  it('produces a compact preview for objects/arrays/scalars', () => {
    expect(compactPreview({ a: 1, b: 2 })).toBe('{ a: 1, b: 2 }');
    expect(compactPreview([1, 2, 3])).toBe('array(3)');
    expect(compactPreview('hi')).toBe('"hi"');
    expect(compactPreview(null)).toBe('null');
  });

  it('pretty-prints nested structures with indentation', () => {
    const out = prettyPrint({ a: 1, b: { c: 2 } });
    expect(out).toContain('"a": 1');
    expect(out).toContain('"b":');
    expect(out).toContain('"c": 2');
    expect(out.trim().startsWith('{')).toBe(true);
    expect(out.trim().endsWith('}')).toBe(true);
  });

  it('counts lines for collapse decisions', () => {
    expect(prettyLineCount({ a: 1 })).toBe(3); // { \n  "a": 1, \n }
    expect(prettyLineCount([])).toBe(1);
  });

  it('exposes status labels', () => {
    const statuses: ToolStatus[] = ['running', 'awaiting-approval', 'completed', 'failed'];
    for (const s of statuses) expect(typeof STATUS_LABEL[s]).toBe('string');
  });
});
