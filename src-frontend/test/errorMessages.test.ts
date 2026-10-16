import { describe, it, expect } from 'vitest';
import { formatError, formatErrorLine } from '../services/errorMessages';

describe('formatError (#30)', () => {
  it('maps connection failure for ollama with actionable guidance', () => {
    const e = formatError(new Error('Failed to fetch'), 'ollama');
    expect(e.title).toMatch(/Ollama/i);
    expect(e.detail).toMatch(/ollama serve|Test|Retry/i);
    // Must not point at a removed banner or a vanished auto-reconnect.
    expect(e.detail).not.toMatch(/banner/i);
  });

  it('maps connection refused for mcp', () => {
    const e = formatError(new Error('ECONNREFUSED'), 'mcp');
    expect(e.title).toMatch(/MCP/i);
  });

  it('maps timeouts', () => {
    const e = formatError(new Error('request timed out'), 'ollama');
    expect(e.title).toMatch(/timed out/i);
    expect(e.detail).toMatch(/smaller model|timeout/i);
  });

  it('maps model-not-found', () => {
    const e = formatError(new Error('model "llama3" not found, try pulling it'), 'ollama');
    expect(e.title).toMatch(/not available/i);
    expect(e.detail).toMatch(/pull/i);
  });

  it('maps auth errors', () => {
    const e = formatError(new Error('401 Unauthorized'), 'mcp');
    expect(e.title).toMatch(/Authentication/i);
  });

  it('maps service-unavailable', () => {
    const e = formatError(new Error('503 Service Unavailable'));
    expect(e.title).toMatch(/unavailable/i);
  });

  it('passes through rate-limit messages', () => {
    const e = formatError(new Error('Too many token requests — retry in 5s.'));
    expect(e.detail).toMatch(/retry in 5s/);
  });

  it('maps cli denied with context', () => {
    const e = formatError(new Error('command not allowed'), 'cli');
    expect(e.title).toMatch(/blocked/i);
  });

  it('falls back gracefully for unknown errors', () => {
    const e = formatError(new Error('weird internal glitch'));
    expect(e.title).toBe('Something went wrong');
    expect(e.detail).toContain('weird internal glitch');
  });

  it('accepts string and non-error inputs', () => {
    expect(formatError('plain string').detail).toContain('plain string');
    expect(formatError({ code: 1 }).title).toBeTruthy();
  });

  it('formatErrorLine joins title and detail', () => {
    const line = formatErrorLine(new Error('Failed to fetch'), 'ollama');
    expect(line).toMatch(/Cannot reach Ollama —/);
  });
});

describe('openai-compatible error context (#571/#580)', () => {
  const conn = { label: 'My LM Studio', baseUrl: 'http://127.0.0.1:1234' };

  it('network failure names the host, never "start Ollama"', () => {
    const e = formatError(new Error('Failed to fetch'), 'openai-compatible', conn);
    expect(e.title).toMatch(/LM Studio/);
    expect(e.detail).toContain('http://127.0.0.1:1234');
    expect(e.detail).not.toMatch(/ollama serve|Ollama isn't running/i);
  });

  it('network failure without a provider falls back to generic labels', () => {
    const e = formatError(new Error('connection refused'), 'openai-compatible');
    expect(e.title).toMatch(/Cannot reach the model server/);
    expect(e.detail).toMatch(/Providers panel/);
  });

  it('model-not-found says it is not loaded on the server, not the Ollama panel', () => {
    const e = formatError(new Error('model "llama3" not found'), 'openai-compatible', conn);
    expect(e.title).toMatch(/not available on/);
    expect(e.detail).toMatch(/not loaded/);
    expect(e.detail).not.toMatch(/Model Management panel|ollama pull/i);
  });

  it('formatErrorLine opens with the host name', () => {
    const line = formatErrorLine(new Error('Failed to fetch'), 'openai-compatible', conn);
    expect(line).toMatch(/Cannot reach My LM Studio/);
  });
});
