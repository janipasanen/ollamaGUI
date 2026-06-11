import { describe, it, expect, beforeEach } from 'vitest';
import {
  memorySet,
  memoryGet,
  memoryDelete,
  memoryList,
  memoryClear,
  buildMemoryContext,
  compactMessages,
  registerMemoryTools,
  _mocks,
} from '../services/crossSessionMemory';
import type { Message } from '../services/ollama';

// Minimal in-memory localStorage shim
function makeStorage(): Storage {
  const data: Record<string, string> = {};
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
    clear: () => { Object.keys(data).forEach(k => delete data[k]); },
    get length() { return Object.keys(data).length; },
    key: (i) => Object.keys(data)[i] ?? null,
  } as Storage;
}

beforeEach(() => {
  _mocks.storage = makeStorage();
});

// ── key-value store ────────────────────────────────────────────────────────────

describe('memorySet / memoryGet (#95)', () => {
  it('stores and retrieves a value', () => {
    memorySet('user_name', 'Alice');
    expect(memoryGet('user_name')).toBe('Alice');
  });

  it('returns null for unknown key', () => {
    expect(memoryGet('nonexistent')).toBeNull();
  });

  it('overwrites existing key', () => {
    memorySet('theme', 'dark');
    memorySet('theme', 'light');
    expect(memoryGet('theme')).toBe('light');
  });

  it('stores multiple independent keys', () => {
    memorySet('a', '1');
    memorySet('b', '2');
    expect(memoryGet('a')).toBe('1');
    expect(memoryGet('b')).toBe('2');
  });
});

describe('memoryDelete (#95)', () => {
  it('deletes an existing key and returns true', () => {
    memorySet('x', 'val');
    expect(memoryDelete('x')).toBe(true);
    expect(memoryGet('x')).toBeNull();
  });

  it('returns false when key does not exist', () => {
    expect(memoryDelete('nope')).toBe(false);
  });
});

describe('memoryList (#95)', () => {
  it('returns empty array when nothing stored', () => {
    expect(memoryList()).toEqual([]);
  });

  it('lists all stored entries', () => {
    memorySet('k1', 'v1');
    memorySet('k2', 'v2');
    const keys = memoryList().map(e => e.key);
    expect(keys).toContain('k1');
    expect(keys).toContain('k2');
  });
});

describe('memoryClear (#95)', () => {
  it('removes all entries', () => {
    memorySet('a', '1');
    memorySet('b', '2');
    memoryClear();
    expect(memoryList()).toEqual([]);
  });
});

describe('buildMemoryContext (#95)', () => {
  it('returns null when no entries', () => {
    expect(buildMemoryContext()).toBeNull();
  });

  it('returns a formatted context block', () => {
    memorySet('lang', 'TypeScript');
    const block = buildMemoryContext();
    expect(block).toContain('lang');
    expect(block).toContain('TypeScript');
  });
});

// ── compactMessages ────────────────────────────────────────────────────────────

describe('compactMessages (#95)', () => {
  function makeMsg(role: Message['role'], content: string): Message {
    return { role, content };
  }

  it('returns messages unchanged when under budget', () => {
    const msgs = [makeMsg('user', 'hi'), makeMsg('assistant', 'hello')];
    expect(compactMessages(msgs, 100000)).toEqual(msgs);
  });

  it('preserves system messages', () => {
    const sys = makeMsg('system', 'You are helpful.');
    const msgs = [sys, ...Array.from({ length: 20 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(200)))];
    const compacted = compactMessages(msgs, 100);
    expect(compacted[0].role).toBe('system');
    expect(compacted[0].content).toBe('You are helpful.');
  });

  it('always keeps the tail turns', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(200)));
    const compacted = compactMessages(msgs, 50, 4);
    // Last 4 messages should survive verbatim
    expect(compacted.slice(-4)).toEqual(msgs.slice(-4));
  });

  it('inserts a summary message for compacted content', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', 'word '.repeat(50)));
    const compacted = compactMessages(msgs, 100, 4);
    const summaryMsg = compacted.find(m => m.content.startsWith('[Earlier conversation summary]'));
    expect(summaryMsg).toBeDefined();
  });

  it('total length is less than original when compaction happens', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(200)));
    const compacted = compactMessages(msgs, 100);
    expect(compacted.length).toBeLessThan(msgs.length);
  });
});

// ── Tool registration ──────────────────────────────────────────────────────────

describe('registerMemoryTools (#95)', () => {
  it('registers memory tools in toolRegistry', async () => {
    const { toolRegistry } = await import('../services/tools');
    registerMemoryTools();
    expect(toolRegistry.getTool('memory_set')).toBeDefined();
    expect(toolRegistry.getTool('memory_get')).toBeDefined();
    expect(toolRegistry.getTool('memory_list')).toBeDefined();
    expect(toolRegistry.getTool('memory_delete')).toBeDefined();
  });

  it('memory_set tool stores a value', async () => {
    const { toolRegistry } = await import('../services/tools');
    registerMemoryTools();
    await toolRegistry.getTool('memory_set')!.execute({ key: 'tool_key', value: 'tool_val' });
    expect(memoryGet('tool_key')).toBe('tool_val');
  });
});
