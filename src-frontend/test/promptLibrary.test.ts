import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPrompts,
  savePrompts,
  addPrompt,
  updatePrompt,
  removePrompt,
  findPrompt,
  type SavedPrompt,
} from '../services/promptLibrary';

const KEY = 'ollama_gui_prompts';

function seed(prompts: SavedPrompt[]) {
  localStorage.clear();
  savePrompts(prompts);
}

beforeEach(() => {
  localStorage.clear();
});

describe('loadPrompts / savePrompts (#97)', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(loadPrompts()).toEqual([]);
  });

  it('tolerates corrupt JSON without throwing', () => {
    localStorage.setItem(KEY, '{ not valid');
    expect(() => loadPrompts()).not.toThrow();
    expect(loadPrompts()).toEqual([]);
  });

  it('round-trips prompts through localStorage', () => {
    const prompt = addPrompt({ name: 'review', body: 'Please review' });
    const loaded = loadPrompts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('review');
    expect(loaded[0].body).toBe('Please review');
  });
});

describe('addPrompt (#97)', () => {
  it('assigns a uuid id and timestamp and persists', () => {
    const prompt = addPrompt({ name: 'explain', body: 'Explain this' });
    expect(prompt.id).toBeTruthy();
    expect(typeof prompt.createdAt).toBe('number');
    expect(findPrompt(prompt.id)?.name).toBe('explain');
  });

  it('appends without mutating prior entries', () => {
    const a = addPrompt({ name: 'one', body: '1' });
    const b = addPrompt({ name: 'two', body: '2' });
    expect(b.id).not.toBe(a.id);
    const all = loadPrompts();
    expect(all.map(p => p.name)).toEqual(['one', 'two']);
  });
});

describe('updatePrompt (#97)', () => {
  it('applies a partial patch and persists', () => {
    const a = addPrompt({ name: 'review', body: 'draft' });
    updatePrompt(a.id, { body: 'final' });
    const updated = findPrompt(a.id);
    expect(updated?.name).toBe('review');
    expect(updated?.body).toBe('final');
  });

  it('is a no-op for a missing id', () => {
    addPrompt({ name: 'keep', body: 'keep' });
    updatePrompt('does-not-exist', { name: 'changed' });
    expect(loadPrompts().map(p => p.name)).toEqual(['keep']);
  });
});

describe('removePrompt (#97)', () => {
  it('deletes an existing prompt and persists', () => {
    const a = addPrompt({ name: 'gone', body: 'x' });
    removePrompt(a.id);
    expect(findPrompt(a.id)).toBeUndefined();
    expect(loadPrompts()).toHaveLength(0);
  });

  it('is a no-op for a missing id', () => {
    addPrompt({ name: 'keep', body: 'keep' });
    removePrompt('does-not-exist');
    expect(loadPrompts()).toHaveLength(1);
  });
});

describe('findPrompt (#97)', () => {
  it('finds a prompt by id and returns undefined when absent', () => {
    const a = addPrompt({ name: 'findme', body: 'x' });
    expect(findPrompt(a.id)?.name).toBe('findme');
    expect(findPrompt('nope')).toBeUndefined();
  });
});
