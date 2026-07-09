import { describe, it, expect } from 'vitest';
import { chatToMarkdown, messageToMarkdown, chatToPlainText, messageToPlainText, chatToHtml, messageToHtml } from '../services/chatToMarkdown';
import type { Message } from '../services/ollama';

const now = new Date(2026, 2, 5, 10, 0, 0).getTime();

describe('chatToMarkdown (#256)', () => {
  it('renders role headings + content for a simple conversation', () => {
    const md = chatToMarkdown([
      { role: 'user', content: 'Hello', ts: now },
      { role: 'assistant', content: 'Hi there', ts: now },
    ], { now });
    expect(md).toContain('# ');
    expect(md).toContain('## User');
    expect(md).toContain('Hello');
    expect(md).toContain('## Assistant');
    expect(md).toContain('Hi there');
  });

  it('includes the title as an H1 when provided', () => {
    const md = chatToMarkdown([{ role: 'user', content: 'hi', ts: now }], { title: 'My Chat', now });
    expect(md.startsWith('# My Chat')).toBe(true);
  });

  it('includes reasoning under a Thinking blockquote', () => {
    const md = chatToMarkdown([
      { role: 'assistant', content: 'Answer', reasoning: 'step 1\nstep 2', ts: now },
    ], { now });
    expect(md).toContain('> **Thinking**');
    expect(md).toContain('> step 1');
    expect(md).toContain('> step 2');
    expect(md).toContain('Answer');
  });

  it('includes the producedByModel label and timestamp in the assistant heading', () => {
    const ts = new Date(2026, 2, 5, 14, 32, 0).getTime();
    const md = chatToMarkdown([{ role: 'assistant', content: 'ok', producedByModel: 'llama3:8b', ts }], { now });
    expect(md).toMatch(/## Assistant — \*llama3:8b\* · 14:32/);
  });

  it('summarises tool calls and image attachments without inlining them', () => {
    const md = chatToMarkdown([
      { role: 'tool', content: 'result data' },
      { role: 'user', content: 'see image', images: ['data:image/png;base64,AAAA'], ts: now },
    ], { now });
    expect(md).toContain('## Tool');
    expect(md).toContain('result data');
    expect(md).not.toContain('base64,AAAA');
    expect(md).toMatch(/1 image attachment/);
  });

  it('handles an empty conversation', () => {
    expect(chatToMarkdown([], { now }).trim()).toBe('');
  });

  it('skips empty content gracefully', () => {
    const md = chatToMarkdown([{ role: 'assistant', content: '', ts: now }], { now });
    expect(md).toContain('## Assistant');
  });
});


describe('messageToMarkdown (#268)', () => {
  it('renders a single message with a role heading and content', () => {
    const md = messageToMarkdown({ role: 'assistant', content: 'Hello world', ts: now }, now);
    expect(md).toContain('## Assistant');
    expect(md).toContain('Hello world');
    expect(md).not.toMatch(/^# /m);
  });

  it('includes the reasoning trace as a blockquote', () => {
    const md = messageToMarkdown({ role: 'assistant', content: 'Answer', reasoning: 'because...', ts: now }, now);
    expect(md).toContain('> **Thinking**');
    expect(md).toContain('> because...');
    expect(md).toContain('Answer');
  });

  it('summarises image attachments instead of inlining them', () => {
    const md = messageToMarkdown({ role: 'user', content: 'see this', images: ['data:image/png;base64,AAAA'], ts: now }, now);
    expect(md).toMatch(/1 image attachment/);
    expect(md).not.toContain('base64,AAAA');
  });

  it('composes the same per-message body as chatToMarkdown', () => {
    const msg: Message = { role: 'user', content: 'Hi', ts: now };
    expect(messageToMarkdown(msg, now)).toBe(chatToMarkdown([msg], { now }));
  });
});


// ── Plain-text export (#333) ─────────────────────────────────────────────────

describe('chatToPlainText (#333)', () => {
  it('renders Role: content without markdown syntax', () => {
    const txt = chatToPlainText([
      { role: 'user', content: 'Hello', ts: now },
      { role: 'assistant', content: 'Hi **there**', ts: now },
    ]);
    expect(txt).toContain('User:');
    expect(txt).toContain('Hello');
    expect(txt).toContain('Assistant:');
    expect(txt).toContain('Hi there');
    expect(txt).not.toContain('**');
  });

  it('strips code fences, headers, links, and list markers', () => {
    const msg: Message = { role: 'assistant', content: '## Title\n\nSee [link](https://x.com)\n\n```js\nconst x = 1;\n```\n\n- item', ts: now };
    const txt = messageToPlainText(msg);
    expect(txt).not.toContain('##');
    expect(txt).not.toContain('```');
    expect(txt).toContain('link');
    expect(txt).toContain('const x = 1;');
    expect(txt).toContain('item');
  });

  it('includes a title header when provided', () => {
    const txt = chatToPlainText([{ role: 'user', content: 'Hi', ts: now }], { title: 'My Chat' });
    expect(txt.startsWith('My Chat')).toBe(true);
  });

  it('summarises image attachments and tool calls', () => {
    const msg: Message = { role: 'assistant', content: 'ok', images: ['data:image/png;base64,AAA'], tool_calls: [{ function: { name: 'search' } } as any], ts: now };
    const txt = messageToPlainText(msg);
    expect(txt).toContain('1 image attachment');
    expect(txt).toContain('Tool calls: search');
  });
});


// ── HTML export (#343) ───────────────────────────────────────────────────────

describe('chatToHtml (#343)', () => {
  it('produces a self-contained HTML document with doctype and title', () => {
    const html = chatToHtml([{ role: 'user', content: 'Hi', ts: now }], { title: 'My Chat' });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>My Chat</title>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('escapes HTML special characters in content', () => {
    const msg: Message = { role: 'user', content: '<script>alert(1)</script>', ts: now };
    const html = messageToHtml(msg);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders fenced code blocks as pre/code', () => {
    const fence = String.fromCharCode(96, 96, 96);
    const msg: Message = { role: 'assistant', content: 'Code:\n' + fence + 'js\nconst x = 1;\n' + fence, ts: now };
    const html = messageToHtml(msg);
    expect(html).toContain('<pre><code>');
    expect(html).toContain('const x = 1;');
  });

  it('includes role class hooks for styling', () => {
    const html = chatToHtml([
      { role: 'user', content: 'Hi', ts: now },
      { role: 'assistant', content: 'Hello', ts: now },
    ]);
    expect(html).toContain('msg-user');
    expect(html).toContain('msg-assistant');
  });
});
