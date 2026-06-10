import { describe, it, expect, vi } from 'vitest';
import { storage } from '../services/storage';

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
    expect(sessions).toContainEqual(session);
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
