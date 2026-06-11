import { describe, it, expect, beforeEach } from 'vitest';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateConversationTokens,
  loadPricing,
  savePricing,
  estimateCost,
  formatTokenCount,
  formatCost,
} from '../services/tokenEstimate';

function makeStorage(): Storage {
  const data: Record<string, string> = {};
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
    clear: () => { Object.keys(data).forEach(k => delete data[k]); },
    get length() { return Object.keys(data).length; },
    key: (i) => Object.keys(data)[i] ?? null,
  } as Storage;
}

beforeEach(() => {
  globalThis.localStorage = makeStorage();
});

describe('estimateTokens (#62)', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
  it('returns at least 1 for non-empty text', () => {
    expect(estimateTokens('a')).toBeGreaterThanOrEqual(1);
  });
  it('scales with text length', () => {
    const short = estimateTokens('hello world');
    const long = estimateTokens('hello world '.repeat(50));
    expect(long).toBeGreaterThan(short);
  });
  it('gives a plausible estimate for a sentence', () => {
    // "The quick brown fox jumps over the lazy dog" ~ 9 words; expect ~9-13 tokens
    const t = estimateTokens('The quick brown fox jumps over the lazy dog');
    expect(t).toBeGreaterThan(6);
    expect(t).toBeLessThan(20);
  });
});

describe('estimateMessageTokens / conversation (#62)', () => {
  it('adds role overhead per message', () => {
    const t = estimateMessageTokens({ role: 'user', content: 'hi' });
    expect(t).toBeGreaterThan(estimateTokens('hi'));
  });
  it('sums across a conversation', () => {
    const msgs = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi there' },
    ];
    const total = estimateConversationTokens(msgs);
    expect(total).toBe(
      estimateMessageTokens(msgs[0]) + estimateMessageTokens(msgs[1]),
    );
  });
  it('handles an empty conversation', () => {
    expect(estimateConversationTokens([])).toBe(0);
  });
});

describe('pricing + cost (#62)', () => {
  it('defaults to zero price (local models)', () => {
    expect(loadPricing().pricePer1k).toBe(0);
    expect(estimateCost(10_000)).toBe(0);
  });
  it('persists and loads pricing', () => {
    savePricing({ pricePer1k: 0.5, currency: '$' });
    expect(loadPricing().pricePer1k).toBe(0.5);
  });
  it('computes cost from tokens', () => {
    const pricing = { pricePer1k: 2, currency: '$' };
    expect(estimateCost(1000, pricing)).toBe(2);
    expect(estimateCost(500, pricing)).toBe(1);
  });
  it('ignores negative/invalid stored price', () => {
    savePricing({ pricePer1k: -5 as number, currency: '$' });
    expect(loadPricing().pricePer1k).toBe(0);
  });
});

describe('formatting (#62)', () => {
  it('formats small token counts as-is', () => {
    expect(formatTokenCount(42)).toBe('42');
  });
  it('formats large token counts with k', () => {
    expect(formatTokenCount(1234)).toBe('1.2k');
  });
  it('returns empty cost string when pricing unset', () => {
    expect(formatCost(10_000)).toBe('');
  });
  it('formats cost with currency when priced', () => {
    const pricing = { pricePer1k: 3, currency: '$' };
    expect(formatCost(1000, pricing)).toBe('$3.00');
  });
});
