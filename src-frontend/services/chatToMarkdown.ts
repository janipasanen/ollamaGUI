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

// ─── HTML export (#343) ──────────────────────────────────────────────────────

/** Escape HTML special characters in a string. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a single message to an HTML fragment for `.html` export (#343).
 * Escapes content; preserves code blocks and paragraphs.
 */
export function messageToHtml(m: Message): string {
  const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
  const parts: string[] = [`<div class="msg msg-${escapeHtml(m.role)}">`];
  parts.push(`<div class="msg-role">${escapeHtml(role)}</div>`);
  if (m.reasoning && m.reasoning.trim()) {
    parts.push(`<div class="msg-thinking"><em>Thinking</em><pre>${escapeHtml(m.reasoning)}</pre></div>`);
  }
  if (m.content && m.content.trim()) {
    // Split fenced code blocks out so they render as <pre><code>.
    const segments = m.content.split(/```/);
    let inCode = false;
    const body: string[] = [];
    for (let idx = 0; idx < segments.length; idx++) {
      const seg = segments[idx];
      if (inCode) {
        // First line may be a language tag.
        const nl = seg.indexOf('\n');
        const code = nl >= 0 ? seg.slice(nl + 1) : seg;
        body.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
      } else {
        const text = seg.trim();
        if (text) body.push(`<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`);
      }
      inCode = !inCode;
    }
    parts.push(`<div class="msg-content">${body.join('')}</div>`);
  }
  if (m.tool_calls && m.tool_calls.length > 0) {
    const names = m.tool_calls.map(tc => escapeHtml((tc as any)?.function?.name ?? (tc as any)?.name ?? 'tool'));
    parts.push(`<div class="msg-tools">Tool calls: ${names.join(', ')}</div>`);
  }
  if (m.images && m.images.length > 0) {
    parts.push(`<div class="msg-images">${m.images.length} image attachment${m.images.length > 1 ? 's' : ''}</div>`);
  }
  parts.push('</div>');
  return parts.join('\n');
}

/**
 * Render a conversation to a self-contained HTML document string (#343).
 */
export function chatToHtml(
  messages: Message[],
  opts: { title?: string } = {},
): string {
  const title = opts.title ?? 'Conversation';
  const body = messages.map(messageToHtml).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; background: #fafafa; }
  h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
  .msg { margin-bottom: 1.25rem; padding: 1rem 1.25rem; border-radius: 0.75rem; }
  .msg-user { background: #dbeafe; }
  .msg-assistant { background: #f1f1f1; }
  .msg-tool { background: #fef3c7; border-left: 3px solid #f59e0b; }
  .msg-system { background: #e0e7ff; }
  .msg-role { font-size: 0.75rem; text-transform: uppercase; font-weight: 700; opacity: 0.6; margin-bottom: 0.5rem; }
  .msg-content p { margin: 0.5rem 0; line-height: 1.6; }
  .msg-content pre { background: #1e1e1e; color: #e0e0e0; padding: 0.75rem 1rem; border-radius: 0.5rem; overflow-x: auto; }
  .msg-content code { font-family: 'SF Mono', Menlo, Consolas, monospace; }
  .msg-thinking { opacity: 0.75; border-left: 2px solid #888; padding-left: 0.75rem; margin: 0.5rem 0; }
  .msg-thinking pre { white-space: pre-wrap; font-size: 0.85em; }
  .msg-tools, .msg-images { font-size: 0.8rem; opacity: 0.7; margin-top: 0.5rem; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>
`;
}
