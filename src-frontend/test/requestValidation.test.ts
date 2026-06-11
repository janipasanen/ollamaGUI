import { describe, it, expect } from 'vitest';
import {
  validateHttpUrl,
  validateMcpServer,
  validateCliCommand,
  sanitizeText,
  isNonEmptySubmission,
} from '../services/requestValidation';

describe('validateHttpUrl (#31, #36)', () => {
  it('accepts https URLs', () => {
    expect(validateHttpUrl('https://example.com/mcp').valid).toBe(true);
  });
  it('accepts http URLs', () => {
    expect(validateHttpUrl('http://localhost:3000').valid).toBe(true);
  });
  it('rejects empty input', () => {
    const r = validateHttpUrl('  ');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/required/i);
  });
  it('rejects malformed URLs', () => {
    expect(validateHttpUrl('not a url').valid).toBe(false);
  });
  it('rejects non-http schemes (injection guard)', () => {
    expect(validateHttpUrl('file:///etc/passwd').valid).toBe(false);
    expect(validateHttpUrl('javascript:alert(1)').valid).toBe(false);
  });
});

describe('validateCliCommand (#36)', () => {
  it('accepts a plain command', () => {
    expect(validateCliCommand('git status').valid).toBe(true);
  });
  it('rejects empty commands', () => {
    expect(validateCliCommand('   ').valid).toBe(false);
  });
  it('rejects command chaining with semicolon', () => {
    expect(validateCliCommand('ls; rm -rf /').valid).toBe(false);
  });
  it('rejects pipes and backticks', () => {
    expect(validateCliCommand('cat x | sh').valid).toBe(false);
    expect(validateCliCommand('echo `whoami`').valid).toBe(false);
  });
  it('rejects command substitution', () => {
    expect(validateCliCommand('echo $(id)').valid).toBe(false);
  });
});

describe('validateMcpServer (#36)', () => {
  it('requires a name', () => {
    const r = validateMcpServer({ name: '', type: 'http', url: 'https://x.com' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/name/i);
  });
  it('validates http servers by URL', () => {
    expect(validateMcpServer({ name: 'X', type: 'http', url: 'https://x.com' }).valid).toBe(true);
    expect(validateMcpServer({ name: 'X', type: 'http', url: 'ftp://x.com' }).valid).toBe(false);
  });
  it('validates stdio servers by command', () => {
    expect(validateMcpServer({ name: 'X', type: 'stdio', command: 'npx server' }).valid).toBe(true);
    expect(validateMcpServer({ name: 'X', type: 'stdio', command: '' }).valid).toBe(false);
    expect(validateMcpServer({ name: 'X', type: 'stdio', command: 'a && b' }).valid).toBe(false);
  });
  it('requires a type', () => {
    expect(validateMcpServer({ name: 'X' }).valid).toBe(false);
  });
});

describe('sanitizeText (#36)', () => {
  it('strips control characters', () => {
    expect(sanitizeText('hel\x00lo\x07')).toBe('hello');
  });
  it('preserves tabs and newlines', () => {
    expect(sanitizeText('a\tb\nc')).toBe('a\tb\nc');
  });
  it('trims surrounding whitespace', () => {
    expect(sanitizeText('  hi  ')).toBe('hi');
  });
  it('handles empty/undefined input', () => {
    expect(sanitizeText('')).toBe('');
    // @ts-expect-error testing null tolerance
    expect(sanitizeText(undefined)).toBe('');
  });
});

describe('isNonEmptySubmission (#31)', () => {
  it('is false for empty text and no attachments', () => {
    expect(isNonEmptySubmission('   ', 0)).toBe(false);
  });
  it('is true with text', () => {
    expect(isNonEmptySubmission('hello', 0)).toBe(true);
  });
  it('is true with attachments only', () => {
    expect(isNonEmptySubmission('', 2)).toBe(true);
  });
});
