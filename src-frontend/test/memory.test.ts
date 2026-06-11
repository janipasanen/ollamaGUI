import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadMemory, saveMemory, addMemoryEntry, removeMemoryEntry, updateMemoryEntry,
  getRelevantEntries, composeMemoryBlock,
  type MemoryEntry,
} from '../services/memory';

beforeEach(() => {
  localStorage.clear();
});

describe('memory CRUD (#95)', () => {
  it('loadMemory returns empty array when nothing stored', () => {
    expect(loadMemory()).toEqual([]);
  });

  it('addMemoryEntry persists with id and createdAt', () => {
    const e = addMemoryEntry('User prefers dark mode');
    expect(e.id).toBeTruthy();
    expect(e.scope).toBe('global');
    expect(e.createdAt).toBeGreaterThan(0);
    expect(loadMemory()).toHaveLength(1);
  });

  it('addMemoryEntry with projectId scope', () => {
    addMemoryEntry('Use TypeScript always', 'proj1');
    const entries = loadMemory();
    expect(entries[0].scope).toBe('proj1');
  });

  it('saveMemory + loadMemory round-trips', () => {
    const entries: MemoryEntry[] = [
      { id: '1', text: 'fact A', scope: 'global', createdAt: 1 },
      { id: '2', text: 'fact B', scope: 'p1', createdAt: 2 },
    ];
    saveMemory(entries);
    expect(loadMemory()).toEqual(entries);
  });

  it('removeMemoryEntry deletes by id', () => {
    const e = addMemoryEntry('removable fact');
    removeMemoryEntry(e.id);
    expect(loadMemory()).toHaveLength(0);
  });

  it('updateMemoryEntry patches text and scope', () => {
    const e = addMemoryEntry('old text');
    updateMemoryEntry(e.id, { text: 'new text', scope: 'p2' });
    const updated = loadMemory().find(x => x.id === e.id);
    expect(updated?.text).toBe('new text');
    expect(updated?.scope).toBe('p2');
  });
});

describe('getRelevantEntries (#95)', () => {
  beforeEach(() => {
    saveMemory([
      { id: '1', text: 'global fact', scope: 'global', createdAt: 1 },
      { id: '2', text: 'project A fact', scope: 'projA', createdAt: 2 },
      { id: '3', text: 'project B fact', scope: 'projB', createdAt: 3 },
    ]);
  });

  it('returns all global entries when no projectId', () => {
    const entries = getRelevantEntries();
    expect(entries.map(e => e.id)).toContain('1');
    expect(entries.map(e => e.id)).not.toContain('2');
    expect(entries.map(e => e.id)).not.toContain('3');
  });

  it('returns global + matching project entries', () => {
    const entries = getRelevantEntries('projA');
    const ids = entries.map(e => e.id);
    expect(ids).toContain('1');
    expect(ids).toContain('2');
    expect(ids).not.toContain('3');
  });
});

describe('composeMemoryBlock (#95)', () => {
  it('returns empty string when no entries', () => {
    expect(composeMemoryBlock()).toBe('');
  });

  it('includes entry text in block', () => {
    addMemoryEntry('user likes coffee');
    const block = composeMemoryBlock();
    expect(block).toContain('user likes coffee');
  });

  it('includes the delimiter header', () => {
    addMemoryEntry('fact');
    const block = composeMemoryBlock();
    expect(block).toContain('Persistent Memory');
  });

  it('respects maxChars limit', () => {
    for (let i = 0; i < 20; i++) addMemoryEntry(`fact ${'x'.repeat(200)} ${i}`);
    const block = composeMemoryBlock(undefined, 500);
    expect(block.length).toBeLessThanOrEqual(600); // a bit over due to delimiters
  });
});
