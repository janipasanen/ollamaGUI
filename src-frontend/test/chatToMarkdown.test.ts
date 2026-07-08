import { describe, it, expect } from 'vitest';
import { chatToMarkdown, messageToMarkdown } from '../services/chatToMarkdown';
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
