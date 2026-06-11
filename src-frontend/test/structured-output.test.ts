import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchOllamaChatStream } from '../services/ollama';
import { parseSchemaInput, validateAgainstSchema, classifyResponse } from '../services/structuredOutput';

describe('structured output request wiring (#148)', () => {
  let origFetch: typeof global.fetch;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  function streamMock() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }) }) },
    });
    global.fetch = fetchMock as any;
    return fetchMock;
  }

  it('includes format in the request body when provided', async () => {
    const fetchMock = streamMock();
    const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
    await fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }], () => {}, 'http://x/api/chat', false, undefined, undefined, schema);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.format).toEqual(schema);
  });

  it('omits format when not provided', async () => {
    const fetchMock = streamMock();
    await fetchOllamaChatStream('m', [{ role: 'user', content: 'hi' }], () => {}, 'http://x/api/chat');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.format).toBeUndefined();
  });
});

describe('schema parsing + validation (#148)', () => {
  it('parseSchemaInput: empty = plain json mode, object ok, malformed/array rejected', () => {
    expect(parseSchemaInput('')).toEqual({ ok: true, schema: undefined });
    expect(parseSchemaInput('{"type":"object"}')).toEqual({ ok: true, schema: { type: 'object' } });
    expect(parseSchemaInput('{not json').ok).toBe(false);
    expect(parseSchemaInput('[1,2]').ok).toBe(false); // must be an object
  });

  it('validateAgainstSchema flags missing required + wrong types', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } }, required: ['name'] };
    expect(validateAgainstSchema({ name: 'Ada', age: 36 }, schema).valid).toBe(true);
    expect(validateAgainstSchema({ age: 36 }, schema).valid).toBe(false); // missing name
    expect(validateAgainstSchema({ name: 'Ada', age: 1.5 }, schema).valid).toBe(false); // not integer
  });

  it('classifyResponse reflects conformance', () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
    expect(classifyResponse('{"ok":true}', schema)).toBe('valid');
    expect(classifyResponse('{"ok":"yes"}', schema)).toBe('invalid'); // wrong type
    expect(classifyResponse('not json', schema)).toBe('invalid');
    expect(classifyResponse('{"any":1}', undefined)).toBe('valid'); // plain json mode
  });
});
