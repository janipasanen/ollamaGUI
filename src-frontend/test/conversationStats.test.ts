import { describe, it, expect } from 'vitest';
import {
  computeConversationStats,
  countWords,
  countCharacters,
} from '../services/conversationStats';
import type { Message } from '../services/ollama';

const msg = (role: Message['role'], content: string): Message => ({ role, content });

describe('conversationStats (#262)', () => {
  it('countWords splits on whitespace and ignores empty content', () => {
    expect(countWords([msg('user', 'hello world'), msg('assistant', '')])).toBe(2);
    expect(countWords([msg('user', '  one   two  ')])).toBe(2);
  });

  it('countCharacters sums raw content lengths', () => {
    expect(countCharacters([msg('user', 'ab'), msg('assistant', 'cde')])).toBe(5);
  });

  it('computeConversationStats reports totals and role splits', () => {
    const stats = computeConversationStats([
      msg('user', 'hello world'),
      msg('assistant', 'hi there, user'),
      msg('user', 'bye'),
    ]);
    expect(stats.totalMessages).toBe(3);
    expect(stats.userMessages).toBe(2);
    expect(stats.assistantMessages).toBe(1);
    expect(stats.words).toBe(6);
    expect(stats.characters).toBe('hello world'.length + 'hi there, user'.length + 'bye'.length);
    expect(stats.tokens).toBeGreaterThan(0);
  });

  it('returns zeroed stats for an empty conversation', () => {
    const stats = computeConversationStats([]);
    expect(stats.totalMessages).toBe(0);
    expect(stats.userMessages).toBe(0);
    expect(stats.assistantMessages).toBe(0);
    expect(stats.words).toBe(0);
    expect(stats.characters).toBe(0);
    expect(stats.tokens).toBe(0);
  });
});
