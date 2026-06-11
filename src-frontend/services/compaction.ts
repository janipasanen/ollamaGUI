/**
 * Conversation compaction (#95).
 *
 * Estimates token count (chars / 4) and, when the conversation history
 * approaches the context limit, summarises the oldest messages into one
 * synthetic SYSTEM message while preserving the most recent turns.
 *
 * Compacted ranges are marked with { compacted: true } on the summary message
 * so the UI can render a visual separator.
 */

import type { Message } from './ollama';

export interface CompactionOptions {
  /** Characters-per-token estimate for the heuristic (default 4). */
  charsPerToken?: number;
  /** When estimated history token count exceeds this, compact (default 3000). */
  thresholdTokens?: number;
  /** Keep this many recent messages uncompacted (default 8). */
  keepRecent?: number;
  /** Async function to generate the summary (injected for testability). */
  summarizeFn?: (messages: Message[]) => Promise<string>;
}

/** Cheap token-count estimate (chars / 4). */
export function estimateTokens(messages: Message[]): number {
  return Math.ceil(messages.reduce((acc, m) => acc + m.content.length, 0) / 4);
}

/** True when the history (excluding system) warrants compaction. */
export function shouldCompact(messages: Message[], thresholdTokens = 3000): boolean {
  const history = messages.filter(m => m.role !== 'system');
  return estimateTokens(history) > thresholdTokens;
}

/**
 * Compact the conversation. Returns a new message array where the oldest
 * messages (beyond `keepRecent`) are replaced by a single summary message.
 * If the summarizeFn fails or the history is already short, returns the
 * original array unchanged.
 */
export async function compactConversation(
  messages: Message[],
  options: CompactionOptions = {}
): Promise<Message[]> {
  const { thresholdTokens = 3000, keepRecent = 8, summarizeFn } = options;
  if (!shouldCompact(messages, thresholdTokens)) return messages;

  const system = messages.filter(m => m.role === 'system');
  const history = messages.filter(m => m.role !== 'system');

  if (history.length <= keepRecent) return messages;

  const toCompress = history.slice(0, history.length - keepRecent);
  const recent = history.slice(history.length - keepRecent);

  let summary = '';
  if (summarizeFn) {
    try {
      summary = await summarizeFn(toCompress);
    } catch {
      return messages; // compaction failed non-fatally — return unchanged
    }
  } else {
    // Fallback: simple concatenation summary when no LLM is available
    summary = toCompress
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n');
  }

  const summaryMsg: Message & { compacted?: boolean } = {
    role: 'system',
    content: `[Conversation summary — earlier messages compacted]\n${summary}`,
    // @ts-ignore custom field for UI rendering
    compacted: true,
  };

  return [...system, summaryMsg, ...recent];
}

/** Build a summarization prompt and call the Ollama endpoint. */
export function makeSummarizeFn(
  model: string,
  endpoint: string
): (messages: Message[]) => Promise<string> {
  return async (messages: Message[]) => {
    const transcript = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');
    const payload = {
      model,
      messages: [
        { role: 'system', content: 'Summarise the following conversation concisely in 3–5 bullet points, preserving key facts and decisions. Output only the summary.' },
        { role: 'user', content: transcript },
      ],
      stream: false,
    };
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`Summarize failed: ${resp.statusText}`);
    const data = await resp.json();
    return data.message?.content ?? data.response ?? '';
  };
}
