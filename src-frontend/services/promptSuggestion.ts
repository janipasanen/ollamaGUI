/**
 * Inline AI prompt-completion suggestions (#658).
 *
 * Mirrors the Claude Code / Cursor ghost-completion UX: while the user types,
 * the composer asks the configured OpenAI-compatible endpoint to continue the
 * prompt and shows the predicted text as a greyed inline ghost. Pressing Tab
 * accepts the completion and dismisses it on any other keystroke.
 *
 * The endpoint is a plain OpenAI `/v1/chat/completions` streaming request with
 * `stream: true`. Suggestions are best-effort: any network/HTTP/parse error
 * degrades to "no suggestion" so typing is never blocked.
 */

import { isAtTrigger } from './atCommand';
import { isHashTrigger } from './hashCommand';

export interface SuggestionOptions {
  /** Full endpoint, e.g. https://host/v1/chat/completions. */
  url: string;
  /** Optional Bearer token for the endpoint. */
  apiKey?: string;
  /** Model to request the completion from. */
  model: string;
  /** Current composer text. */
  prompt: string;
  /** Abort signal to cancel an in-flight request. */
  signal?: AbortSignal;
  /** Optional system prompt overriding the default completion instructions. */
  systemPrompt?: string;
}

const DEFAULT_SYSTEM =
  'You are an autocomplete engine. The user is typing a prompt. Output ONLY ' +
  'the continuation of their prompt, starting exactly where they left off. ' +
  'Do not repeat what they wrote, do not add any preamble, comments, or ' +
  'explanation. Never start with a newline.';

/**
 * Whether to request an AI completion for the given composer text.
 *
 * While the user is inside a slash / @ / # completion, those dedicated
 * completions own the line; on a blank or overly long input there is nothing
 * sensible to complete, so we skip.
 */
export function shouldRequestSuggestion(text: string): boolean {
  const t = text.trimEnd();
  if (t.length < 2 || t.length > 500) return false;
  if (t.startsWith('/')) return false;
  if (isAtTrigger(t) || isHashTrigger(t)) return false;
  return true;
}
/** Combine the current prompt with an accepted ghost completion. */
export function acceptSuggestion(input: string, suggestion: string): string {
  return input + suggestion;
}

/**
 * Stream an inline prompt-completion suggestion.
 *
 * Yields the accumulated completion text each time the model produces a new
 * delta, so the caller can render a live ghost. Resolves when the stream ends
 * or on error; does not throw for transport-level failures — callers keep
 * typing.
 */
export async function* suggestCompletion(opts: SuggestionOptions): AsyncGenerator<string> {
  if (!shouldRequestSuggestion(opts.prompt)) return;
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model,
        stream: true,
        temperature: 0,
        messages: [
          { role: 'system', content: opts.systemPrompt ?? DEFAULT_SYSTEM },
          { role: 'user', content: opts.prompt },
        ],
      }),
      signal: opts.signal,
    });
  } catch {
    return;
  }
  if (!res.ok || !res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let acc = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
          const delta = json?.choices?.[0]?.delta?.content;
          if (delta) { acc += delta; yield acc; }
        } catch { /* ignore malformed chunk, keep draining */ }
      }
    }
  } catch {
    // Abort or read error — stop yielding, keep any partial suggestion the
    // caller may have chosen to display.
  }
}
