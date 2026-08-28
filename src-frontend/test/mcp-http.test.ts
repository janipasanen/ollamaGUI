import { describe, it, expect } from 'vitest';
import { parseSseMessages, httpBodyErrorDetail } from '../services/mcp-http';

describe('parseSseMessages (#21-22) (#461)', () => {
  it('parses a single data event', () => {
    const out = parseSseMessages('data: {"jsonrpc":"2.0","id":1}\n');
    expect(out).toEqual([{ jsonrpc: '2.0', id: 1 }]);
  });

  it('parses multiple events separated by blank lines, in order', () => {
    const body = [
      'data: {"id":1}',
      '',
      'data: {"id":2}',
      '',
      'data: {"id":3}',
    ].join('\n');
    expect(parseSseMessages(body)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('tolerates \\r\\n line endings', () => {
    const body = 'data: {"id":1}\r\n\r\ndata: {"id":2}\r\n';
    expect(parseSseMessages(body)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('keeps multiple data lines within one event joined into one JSON object', () => {
    const out = parseSseMessages('data: {"a":\ndata: 1}\n');
    expect(out).toEqual([{ a: 1 }]);
  });

  it('skips events that contain no data: lines or non-JSON payloads', () => {
    const body = [
      ': keep-alive comment',
      '',
      'data: not-json',
      '',
      'event: message',
    ].join('\n');
    expect(parseSseMessages(body)).toEqual([]);
  });

  it('returns an empty array for an empty body', () => {
    expect(parseSseMessages('')).toEqual([]);
  });
});

describe('httpBodyErrorDetail (#461)', () => {
  it('returns the fallback when the body is absent', () => {
    expect(httpBodyErrorDetail(undefined, 'fallback')).toBe('fallback');
  });

  it('extracts a string error field', () => {
    expect(httpBodyErrorDetail('{"error":"boom"}', 'fallback')).toBe('boom');
  });

  it('extracts the message nested under error', () => {
    expect(httpBodyErrorDetail('{"error":{"message":"nope"}}', 'fallback')).toBe('nope');
  });

  it('falls back when only a top-level message field exists', () => {
    expect(httpBodyErrorDetail('{"message":"bad request"}', 'fallback')).toBe('bad request');
  });

  it('falls back for JSON with no error or message', () => {
    expect(httpBodyErrorDetail('{"data":1}', 'fallback')).toBe('fallback');
  });

  it('falls back for non-JSON bodies', () => {
    expect(httpBodyErrorDetail('not json at all', 'fallback')).toBe('fallback');
  });
});
