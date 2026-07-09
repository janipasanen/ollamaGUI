import { describe, it, expect } from 'vitest';
import { sortSessions, orderSessions, type ChatSession } from '../services/storage';
import type { Message } from '../services/ollama';

const msg = (role: 'user' | 'assistant', content: string): Message => ({ role, content });

const mk = (title: string, createdAt: number, messages: Message[], pinned = false): ChatSession => ({
  id: title.toLowerCase(),
  title,
  messages,
  createdAt,
  model: 'm',
  pinned,
});

const sessions: ChatSession[] = [
  mk('Zebra', 100, [msg('user', 'hi')]),
  mk('Apple', 300, [msg('user', 'a'), msg('user', 'b'), msg('user', 'c')]),
  mk('Mango', 200, [msg('user', 'x'), msg('user', 'y')]),
];

describe('sortSessions (#327)', () => {
  it('recent mode matches orderSessions (pinned first, newest first)', () => {
    const got = sortSessions(sessions, 'recent');
    const exp = orderSessions(sessions);
    expect(got.map(s => s.title)).toEqual(exp.map(s => s.title));
  });

  it('recent orders newest-first', () => {
    const got = sortSessions(sessions, 'recent');
    expect(got.map(s => s.title)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('name mode sorts alphabetically (case-insensitive)', () => {
    const got = sortSessions(sessions, 'name');
    expect(got.map(s => s.title)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('messages mode sorts by message count descending', () => {
    const got = sortSessions(sessions, 'messages');
    expect(got.map(s => s.title)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('pinned sessions always float to the top regardless of mode', () => {
    const withPinned: ChatSession[] = [
      mk('Zulu', 999, [msg('user', 'z')], true),
      ...sessions,
    ];
    const byName = sortSessions(withPinned, 'name');
    expect(byName[0].title).toBe('Zulu');
    const byMsg = sortSessions(withPinned, 'messages');
    expect(byMsg[0].title).toBe('Zulu');
    const byRecent = sortSessions(withPinned, 'recent');
    expect(byRecent[0].title).toBe('Zulu');
  });

  it('does not mutate the input array', () => {
    const copy = [...sessions];
    sortSessions(sessions, 'name');
    expect(sessions.map(s => s.title)).toEqual(copy.map(s => s.title));
  });
});
