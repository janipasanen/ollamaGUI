import { describe, it, expect, vi } from 'vitest';
import {
  estimateTokens, shouldCompact, compactConversation,
} from '../services/compaction';
import type { Message } from '../services/ollama';

function msg(role: 'user' | 'assistant' | 'system', content: string): Message {
  return { role, content };
}

// ── estimateTokens ────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty array', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('estimates chars/4', () => {
    const msgs: Message[] = [msg('user', 'a'.repeat(400)), msg('assistant', 'b'.repeat(400))];
    expect(estimateTokens(msgs)).toBe(200);
  });
});

// ── shouldCompact ─────────────────────────────────────────────────────────────

describe('shouldCompact', () => {
  it('returns false below threshold', () => {
    const msgs: Message[] = [msg('user', 'hello'), msg('assistant', 'world')];
    expect(shouldCompact(msgs, 3000)).toBe(false);
  });

  it('returns true when history exceeds threshold', () => {
    const big = msg('user', 'x'.repeat(12001)); // ~3000 tokens
    expect(shouldCompact([big], 3000)).toBe(true);
  });

  it('ignores system messages in token count', () => {
    const msgs: Message[] = [
      msg('system', 'x'.repeat(12001)), // large system — should NOT count
      msg('user', 'hi'),
    ];
    expect(shouldCompact(msgs, 3000)).toBe(false);
  });
});

// ── compactConversation ───────────────────────────────────────────────────────

describe('compactConversation', () => {
  const mkHistory = (n: number): Message[] =>
    Array.from({ length: n }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `message ${'x'.repeat(200)} ${i}`));

  it('returns unchanged if below threshold', async () => {
    const msgs: Message[] = [msg('user', 'hello'), msg('assistant', 'world')];
    const result = await compactConversation(msgs, { thresholdTokens: 3000 });
    expect(result).toStrictEqual(msgs);
  });

  it('calls summarizeFn with old messages when above threshold', async () => {
    const summarizeFn = vi.fn().mockResolvedValue('Summary of earlier turns.');
    const history = mkHistory(20); // ~1000 tokens per message → well above 3000
    await compactConversation(history, { thresholdTokens: 100, summarizeFn, keepRecent: 4 });
    expect(summarizeFn).toHaveBeenCalledOnce();
  });

  it('keeps recent messages intact', async () => {
    const summarizeFn = vi.fn().mockResolvedValue('Summary.');
    const history = mkHistory(20);
    const result = await compactConversation(history, { thresholdTokens: 100, summarizeFn, keepRecent: 4 });
    // Last 4 history messages should be preserved
    const recent = history.slice(-4);
    recent.forEach(m => {
      expect(result).toContainEqual(expect.objectContaining({ content: m.content }));
    });
  });

  it('preserves system messages at the top', async () => {
    const summarizeFn = vi.fn().mockResolvedValue('Summary.');
    const msgs: Message[] = [
      msg('system', 'You are helpful.'),
      ...mkHistory(20),
    ];
    const result = await compactConversation(msgs, { thresholdTokens: 100, summarizeFn, keepRecent: 4 });
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('You are helpful.');
  });

  it('inserts a summary message with compacted marker', async () => {
    const summarizeFn = vi.fn().mockResolvedValue('Key facts: A, B, C.');
    const history = mkHistory(20);
    const result = await compactConversation(history, { thresholdTokens: 100, summarizeFn, keepRecent: 4 });
    const summaryMsg = result.find(m => (m as any).compacted);
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg?.content).toContain('Key facts: A, B, C.');
  });

  it('returns original array when summarizeFn throws', async () => {
    const summarizeFn = vi.fn().mockRejectedValue(new Error('network error'));
    const history = mkHistory(20);
    const result = await compactConversation(history, { thresholdTokens: 100, summarizeFn });
    expect(result).toStrictEqual(history);
  });

  it('uses fallback summary when no summarizeFn provided', async () => {
    const history = mkHistory(20);
    const result = await compactConversation(history, { thresholdTokens: 100, keepRecent: 4 });
    // Should still compact (fallback concatenation)
    expect(result.length).toBeLessThan(history.length);
  });
});
