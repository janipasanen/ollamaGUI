/**
 * Structured-output helpers (#148): schema parsing + lightweight JSON-Schema
 * conformance checking + response classification for the UI badge.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSchemaInput, tryParseJson, validateAgainstSchema, classifyResponse,
} from '../services/structuredOutput';

describe('parseSchemaInput (#148)', () => {
  it('empty input = plain json mode (ok, no schema)', () => {
    expect(parseSchemaInput('')).toEqual({ ok: true, schema: undefined });
    expect(parseSchemaInput('   ')).toEqual({ ok: true, schema: undefined });
  });
  it('parses a valid JSON object schema', () => {
    const r = parseSchemaInput('{"type":"object"}');
    expect(r.ok).toBe(true);
    expect(r.schema).toEqual({ type: 'object' });
  });
  it('rejects non-JSON with an error', () => {
    expect(parseSchemaInput('{not json')).toEqual({ ok: false, error: 'Not valid JSON' });
  });
  it('rejects non-object JSON (array / number)', () => {
    expect(parseSchemaInput('[1,2]').ok).toBe(false);
    expect(parseSchemaInput('42').ok).toBe(false);
  });
});

describe('tryParseJson', () => {
  it('parses valid JSON', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });
  it('returns ok:false on invalid JSON', () => {
    expect(tryParseJson('x').ok).toBe(false);
  });
});

describe('validateAgainstSchema (#148)', () => {
  const schema = {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      age: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };

  it('passes a conforming value', () => {
    expect(validateAgainstSchema({ name: 'x', age: 3, tags: ['a'] }, schema))
      .toEqual({ valid: true, errors: [] });
  });
  it('reports a missing required field', () => {
    const r = validateAgainstSchema({ age: 3 }, schema);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('missing required "name"'))).toBe(true);
  });
  it('reports a type mismatch (integer vs number)', () => {
    const r = validateAgainstSchema({ name: 'x', age: 1.5 }, schema);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('expected integer'))).toBe(true);
  });
  it('reports array item type mismatches', () => {
    const r = validateAgainstSchema({ name: 'x', tags: [1] }, schema);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('expected string'))).toBe(true);
  });
  it('treats null as "null" type, not "object"', () => {
    expect(validateAgainstSchema(null, { type: 'null' }).valid).toBe(true);
    expect(validateAgainstSchema(null, { type: 'object' }).valid).toBe(false);
  });
});

describe('classifyResponse (#148)', () => {
  it('non-JSON content is invalid', () => {
    expect(classifyResponse('hello')).toBe('invalid');
  });
  it('any valid JSON is "valid" in plain json mode (no schema)', () => {
    expect(classifyResponse('{}')).toBe('valid');
    expect(classifyResponse('[1,2,3]')).toBe('valid');
  });
  it('valid JSON that matches the schema is valid', () => {
    expect(classifyResponse('{"name":"x"}', { type: 'object', required: ['name'] })).toBe('valid');
  });
  it('valid JSON that violates the schema is invalid', () => {
    expect(classifyResponse('{}', { type: 'object', required: ['name'] })).toBe('invalid');
  });
});
