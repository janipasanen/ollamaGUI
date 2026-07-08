import { describe, it, expect, vi } from 'vitest';
import { storage, parseSessionImport } from '../services/storage';

describe('Storage Service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should save and retrieve a session', () => {
    const session = {
      id: '123',
      title: 'Test Chat',
      messages: [{ role: 'user', content: 'Hello' }],
      createdAt: Date.now(),
      model: 'llama3'
    };
    
    storage.saveSession(session);
    const sessions = storage.getSessions();
    // getSessions migrates in default org fields (#133), so match the core shape.
    expect(sessions[0]).toMatchObject(session);
    expect(sessions[0]).toMatchObject({ tags: [], pinned: false, archived: false });
  });

  it('should delete a session', () => {
    const session = {
      id: '123',
      title: 'Test Chat',
      messages: [],
      createdAt: Date.now(),
      model: 'llama3'
    };
    
    storage.saveSession(session);
    storage.deleteSession('123');
    expect(storage.getSessions()).not.toContainEqual(session);
  });
});

// ── parseSessionImport (#232) ──────────────────────────────────────────────────

describe('parseSessionImport (#232)', () => {
  it('returns parsed sessions for a valid JSON array', () => {
    const text = JSON.stringify([
      { id: 'a', title: 'A', messages: [], createdAt: 1, model: 'llama3' },
      { id: 'b', title: 'B', messages: [{ role: 'user', content: 'hi' }], createdAt: 2, model: 'mistral' },
    ]);
    const sessions = parseSessionImport(text);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('a');
    expect(sessions[1].messages).toHaveLength(1);
  });

  it('migrates organization defaults onto imported sessions', () => {
    const text = JSON.stringify([{ id: 'a', title: 'A', messages: [], createdAt: 1, model: 'm' }]);
    const [session] = parseSessionImport(text);
    expect(session.tags).toEqual([]);
    expect(session.pinned).toBe(false);
    expect(session.archived).toBe(false);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseSessionImport('{not valid json')).toThrow();
  });

  it('throws when the parsed value is not an array', () => {
    expect(() => parseSessionImport(JSON.stringify({ id: 'a' }))).toThrow();
    expect(() => parseSessionImport(JSON.stringify('hello'))).toThrow();
  });

  it('throws when an entry is missing a string id', () => {
    const text = JSON.stringify([{ title: 'no id', messages: [], createdAt: 1, model: 'm' }]);
    expect(() => parseSessionImport(text)).toThrow();
  });

  it('throws when an entry is missing a messages array', () => {
    const text = JSON.stringify([{ id: 'a', title: 'A', createdAt: 1, model: 'm' }]);
    expect(() => parseSessionImport(text)).toThrow();
  });

  it('throws when an entry is not an object', () => {
    const text = JSON.stringify(['not-a-session']);
    expect(() => parseSessionImport(text)).toThrow();
  });
});
