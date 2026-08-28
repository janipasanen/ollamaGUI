import { describe, it, expect, vi } from 'vitest';
import {
  estimateTokens, shouldCompact, compactConversation, makeSummarizeFn,
} from '../services/compaction';
import {
  getCompactionThreshold, loadModelContextConfigs, setModelContextConfig,
} from '../services/modelContextConfig';
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

// ── #459: makeSummarizeFn surfaces body error on non-ok ──────────────────────

describe('makeSummarizeFn error handling (#459)', () => {
  let origFetch: typeof global.fetch;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  it('surfaces body .error on non-ok response (#459)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'model "llama3" not found, try pulling it first' }),
    }) as any;
    const summarize = makeSummarizeFn('llama3', 'http://x/api/chat');
    await expect(summarize([msg('user', 'hi')])).rejects.toThrow('model "llama3" not found');
  });

  it('falls back to statusText when body has no .error (#459)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Service Unavailable',
      json: async () => ({ unrelated: true }),
    }) as any;
    const summarize = makeSummarizeFn('llama3', 'http://x/api/chat');
    await expect(summarize([msg('user', 'hi')])).rejects.toThrow('Summarize failed: Service Unavailable');
  });

  it('returns message content on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'Summary here' } }),
    }) as any;
    const summarize = makeSummarizeFn('llama3', 'http://x/api/chat');
    const result = await summarize([msg('user', 'hi')]);
    expect(result).toBe('Summary here');
  });
});

// ── GAP: compaction respects configured context window & threshold ────────────
// Previously the app summarized at a hardcoded 0.7 × effective context,
// ignoring any per-model `compactionThreshold` stored under
// `model_context_config_v1`. These cases verify the configured threshold is
// what drives when compaction fires (#549 rank 13 / GAP "verify compaction
// respects configured context windows").

describe('configured compaction threshold drives compaction (GAP)', () => {
  const cfgKey = 'model_context_config_v1';
  let stored: string | null;

  beforeEach(() => {
    stored = localStorage.getItem(cfgKey);
  });
  afterEach(() => {
    if (stored === null) localStorage.removeItem(cfgKey);
    else localStorage.setItem(cfgKey, stored);
  });

  it('getCompactionThreshold multiplies window by the configured fraction', () => {
    // 0.8 of a 32768 window -> 26214.4, not the old hardcoded 0.7 (22937.6)
    expect(getCompactionThreshold({ contextWindow: 32768, compactionThreshold: 0.8, autoDetected: false }))
      .toBeCloseTo(26214.4, 5);
  });

  it('reads the configured compactionThreshold back via loadModelContextConfigs', () => {
    setModelContextConfig('local-ollama/llama3', { compactionThreshold: 0.9, contextWindow: 4096 });
    const loaded = loadModelContextConfigs();
    const entry = loaded.get('local-ollama/llama3');
    expect(entry?.compactionThreshold).toBe(0.9);
  });

  it('uses the configured threshold instead of the old fixed 0.7 default', async () => {
    // The app computes compactAt = round(effectiveCtx * configuredThreshold).
    // A user-configured 0.5 threshold (4096 tokens) is eagerer than the old
    // hardcoded 0.7 default (5734 tokens). A conversation of ~5000 tokens
    // compacts under the config but NOT under the old default — proving the
    // stored value is what drives compaction (#549 rank 13).
    setModelContextConfig('local-ollama/qwen3-coder', { compactionThreshold: 0.5, contextWindow: 8192 });

    const configured = Math.round(
      getCompactionThreshold(loadModelContextConfigs().get('local-ollama/qwen3-coder')!),
    );
    const fixedDefault = Math.round(8192 * 0.7);
    expect(configured).toBe(4096);
    expect(fixedDefault).toBe(5734);

    // A ~5000-token conversation spread across 12 turns (~1600 chars each).
    const turns: Message[] = [];
    for (let i = 0; i < 12; i++) {
      turns.push(msg(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(1600)));
    }
    expect(shouldCompact(turns, fixedDefault)).toBe(false);
    expect(shouldCompact(turns, configured)).toBe(true);

    const summarizeFn = vi.fn().mockResolvedValue('Summary.');
    const result = await compactConversation(turns, {
      thresholdTokens: configured,
      summarizeFn,
      keepRecent: 2,
    });
    expect(summarizeFn).toHaveBeenCalledOnce();
    expect(result.some(m => (m as any).compacted)).toBe(true);
  });
});
