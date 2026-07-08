/**
 * Conversation statistics (#262).
 *
 * Computes simple per-conversation aggregates for display in the chat toolbar:
 * message counts (total / user / assistant), word count, character count and an
 * approximate token count (delegated to services/tokenEstimate). Pure and
 * dependency-free so it can be unit-tested in isolation.
 */

import type { Message } from './ollama';
import { estimateConversationTokens } from './tokenEstimate';

export interface ConversationStats {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  words: number;
  characters: number;
  tokens: number;
}

/** Count whitespace-separated words across a set of messages. */
export function countWords(messages: Array<Pick<Message, 'content'>>): number {
  return messages.reduce(
    (sum, m) => sum + (m.content.trim().split(/\s+/).filter(Boolean).length),
    0,
  );
}

/** Count characters across a set of messages. */
export function countCharacters(messages: Array<Pick<Message, 'content'>>): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}

/** Compute the full stats bundle for a conversation. */
export function computeConversationStats(
  messages: Array<Pick<Message, 'role' | 'content'>>,
): ConversationStats {
  return {
    totalMessages: messages.length,
    userMessages: messages.filter(m => m.role === 'user').length,
    assistantMessages: messages.filter(m => m.role === 'assistant').length,
    words: countWords(messages),
    characters: countCharacters(messages),
    tokens: estimateConversationTokens(messages),
  };
}
