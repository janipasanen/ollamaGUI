import type { Message } from './ollama';
import { formatMessageTime } from './formatTime';

/**
 * Render a conversation to a Markdown string for export (#256).
 *
 * Each message becomes a level-2 heading with the role (and optional model +
 * timestamp), followed by the content. Reasoning traces are included under a
 * "Thinking" blockquote. Tool messages render their content inline. Images and
 * tool-call payloads are summarised (not inlined) to keep the export readable.
 */
/**
 * Render a single message to a Markdown string (#268).
 * Used by the per-message "Copy as Markdown" action. The `now` timestamp is
 * used for relative-time rendering in the heading.
 */
export function messageToMarkdown(m: Message, now: number = Date.now()): string {
  const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
  const meta: string[] = [];
  if (m.role === 'assistant' && m.producedByModel) meta.push(`*${m.producedByModel}*`);
  const time = formatMessageTime(m.ts, now);
  if (time) meta.push(time);
  const heading = meta.length > 0 ? `## ${role} — ${meta.join(' · ')}` : `## ${role}`;
  const lines: string[] = [heading, ''];

  if (m.reasoning && m.reasoning.trim()) {
    lines.push('> **Thinking**', '>', ...m.reasoning.split('\n').map(l => `> ${l}`), '');
  }

  if (m.content && m.content.trim()) {
    lines.push(m.content, '');
  }

  if (m.tool_calls && m.tool_calls.length > 0) {
    lines.push('_Tool calls:_', '');
    for (const tc of m.tool_calls) {
      const name = (tc as any)?.function?.name ?? (tc as any)?.name ?? 'tool';
      lines.push(`- \`${name}\``);
    }
    lines.push('');
  }

  if (m.images && m.images.length > 0) {
    lines.push(`_(${m.images.length} image attachment${m.images.length > 1 ? 's' : ''})_`, '');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function chatToMarkdown(
  messages: Message[],
  opts: { title?: string; now?: number } = {},
): string {
  const now = opts.now ?? Date.now();
  const lines: string[] = [];
  if (opts.title) {
    lines.push(`# ${opts.title}`, '');
  }
  for (const m of messages) {
    lines.push(messageToMarkdown(m, now));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ─── Plain-text export (#333) ────────────────────────────────────────────────

/**
 * Render a single message to a plain-text line for `.txt` export (#333).
 * Strips markdown syntax down to a simple "Role: content" format.
 */
export function messageToPlainText(m: Message): string {
  const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
  const lines: string[] = [`${role}:`];
  if (m.reasoning && m.reasoning.trim()) {
    lines.push('[Thinking]', m.reasoning.trim());
  }
  if (m.content && m.content.trim()) {
    lines.push(stripMarkdown(m.content));
  }
  if (m.tool_calls && m.tool_calls.length > 0) {
    const names = m.tool_calls.map(tc => (tc as any)?.function?.name ?? (tc as any)?.name ?? 'tool');
    lines.push(`[Tool calls: ${names.join(', ')}]`);
  }
  if (m.images && m.images.length > 0) {
    lines.push(`[${m.images.length} image attachment${m.images.length > 1 ? 's' : ''}]`);
  }
  return lines.join('\n').trim();
}

/** Strip common markdown formatting to plain text. */
function stripMarkdown(md: string): string {
  return md
    // Fenced code blocks → keep content indented
    .replace(/```[\w-]*\n([\s\S]*?)```/g, (_m, code) => code.trim())
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Bold/italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Headers
    .replace(/^#{1,6}\s+/gm, '')
    // Blockquotes
    .replace(/^>\s?/gm, '')
    // Horizontal rules
    .replace(/^---+$/gm, '')
    // List markers (keep text)
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .trim();
}

/**
 * Render a conversation to a plain-text string for `.txt` export (#333).
 */
export function chatToPlainText(
  messages: Message[],
  opts: { title?: string } = {},
): string {
  const lines: string[] = [];
  if (opts.title) {
    lines.push(opts.title, '');
  }
  for (const m of messages) {
    lines.push(messageToPlainText(m), '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
