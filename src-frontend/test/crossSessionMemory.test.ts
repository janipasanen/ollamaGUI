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


// ── #451: storage key must differ from memory.ts ──────────────────────────────

describe('crossSessionMemory storage key isolation (#451)', () => {
  it('does not collide with memory.ts storage key', () => {
    const storage = makeStorage();
    _mocks.storage = storage;

    // Simulate memory.ts writing an array to 'ollama_gui_memory'
    storage.setItem('ollama_gui_memory', JSON.stringify([
      { id: 'x', text: 'test', scope: 'global', createdAt: 1 },
    ]));

    // crossSessionMemory should NOT read from that key
    memorySet('mykey', 'myval');
    const val = memoryGet('mykey');
    expect(val).toBe('myval');

    // The cross-session memory data should be under its own key, not 'ollama_gui_memory'
    const crossData = storage.getItem('ollama_gui_cross_session_memory');
    expect(crossData).toBeTruthy();
    const parsed = JSON.parse(crossData!);
    expect(parsed.mykey).toBeDefined();
    expect(parsed.mykey.value).toBe('myval');

    // memory.ts's data should be untouched
    const memData = storage.getItem('ollama_gui_memory');
    expect(memData).toBeTruthy();
    const memParsed = JSON.parse(memData!);
    expect(Array.isArray(memParsed)).toBe(true);
    expect(memParsed).toHaveLength(1);
  });
});

// ── #475: saveEntries must not throw on QuotaExceededError ────────────────────

describe('saveEntries QuotaExceededError (#475)', () => {
  it('memorySet does not throw when storage is full', () => {
    const storage = makeStorage();
    storage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    _mocks.storage = storage;
    expect(() => memorySet('key', 'value')).not.toThrow();
  });

  it('memoryDelete does not throw when storage is full', () => {
    const storage = makeStorage();
    // First allow the set so the key exists
    storage.setItem('ollama_gui_cross_session_memory', JSON.stringify({
      key: { key: 'key', value: 'val', updatedAt: 1 },
    }));
    // Now break setItem
    storage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    _mocks.storage = storage;
    expect(() => memoryDelete('key')).not.toThrow();
  });
});
