import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPrompts, savePrompts, addPrompt, updatePrompt, removePrompt, findPrompt,
  type SavedPrompt,
} from '../services/promptLibrary';

beforeEach(() => {
  localStorage.clear();
});

describe('prompt library CRUD (#97)', () => {
  it('addPrompt assigns id and createdAt and persists', () => {
    const p = addPrompt({ name: 'Code review', body: 'Review this code:' });
    expect(p.id).toBeTruthy();
    expect(p.createdAt).toBeGreaterThan(0);
    expect(loadPrompts()).toHaveLength(1);
  });

  it('savePrompts + loadPrompts round-trips', () => {
    const prompts: SavedPrompt[] = [{ id: '1', name: 'A', body: 'Body A', createdAt: 1 }];
    savePrompts(prompts);
    expect(loadPrompts()).toEqual(prompts);
  });

  it('updatePrompt patches name and body', () => {
    const p = addPrompt({ name: 'Old', body: 'Old body' });
    updatePrompt(p.id, { name: 'New', body: 'New body' });
    const updated = findPrompt(p.id);
    expect(updated?.name).toBe('New');
    expect(updated?.body).toBe('New body');
  });

  it('removePrompt deletes by id', () => {
    const p = addPrompt({ name: 'Del', body: 'Del body' });
    removePrompt(p.id);
    expect(findPrompt(p.id)).toBeUndefined();
    expect(loadPrompts()).toHaveLength(0);
  });

  it('findPrompt returns undefined for unknown id', () => {
    expect(findPrompt('nonexistent')).toBeUndefined();
  });

  it('multiple prompts are ordered by insertion', () => {
    addPrompt({ name: 'A', body: 'A' });
    addPrompt({ name: 'B', body: 'B' });
    addPrompt({ name: 'C', body: 'C' });
    const names = loadPrompts().map(p => p.name);
    expect(names).toEqual(['A', 'B', 'C']);
  });
});
