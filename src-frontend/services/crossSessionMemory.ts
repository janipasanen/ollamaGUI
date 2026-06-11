/**
 * Cross-session memory and context compaction (#95).
 *
 * Provides a simple key-value store backed by localStorage so the agent
 * can persist important facts, preferences, or compact context across
 * chat sessions. Also provides a `compactMessages` helper that summarises
 * old turns when the estimated token count would exceed a budget.
 */

import type { Message } from './ollama';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  key: string;
  value: string;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ollama_gui_memory';

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

export const _mocks = {
  storage: null as Storage | null,
};

function store(): Storage {
  return _mocks.storage ?? localStorage;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function loadEntries(): Record<string, MemoryEntry> {
  try {
    const raw = store().getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, MemoryEntry>) : {};
  } catch {
    return {};
  }
}

function saveEntries(entries: Record<string, MemoryEntry>): void {
  store().setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ---------------------------------------------------------------------------
// Key-value API
// ---------------------------------------------------------------------------

export function memorySet(key: string, value: string): void {
  const entries = loadEntries();
  entries[key] = { key, value, updatedAt: Date.now() };
  saveEntries(entries);
}

export function memoryGet(key: string): string | null {
  return loadEntries()[key]?.value ?? null;
}

export function memoryDelete(key: string): boolean {
  const entries = loadEntries();
  if (!(key in entries)) return false;
  delete entries[key];
  saveEntries(entries);
  return true;
}

export function memoryList(): MemoryEntry[] {
  return Object.values(loadEntries()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function memoryClear(): void {
  store().removeItem(STORAGE_KEY);
}

/** Format all memory entries as a system-prompt context block. */
export function buildMemoryContext(): string | null {
  const entries = memoryList();
  if (entries.length === 0) return null;
  const lines = entries.map(e => `- **${e.key}**: ${e.value}`);
  return `# Remembered facts\n\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Context compaction
// ---------------------------------------------------------------------------

/** Rough token estimate: 4 chars ≈ 1 token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageText(msg: Message): string {
  return msg.content;
}

/**
 * Compact a message list so total estimated tokens stay under `budgetTokens`.
 *
 * Strategy:
 *  1. Always keep the system message (if present) and the last `keepTail` turns.
 *  2. Older turns are replaced by a single assistant "summary" message that
 *     describes what was discussed.
 *
 * No LLM call is made here — the summary is a simple concatenation of the
 * content of the compacted messages (truncated to `summaryMaxChars`).
 * A real app would invoke the model to produce the summary; this function
 * provides the structural plumbing.
 */
export function compactMessages(
  messages: Message[],
  budgetTokens = 4000,
  keepTail = 6,
  summaryMaxChars = 800,
): Message[] {
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0);
  if (totalTokens <= budgetTokens) return messages;

  // Separate system message(s) from the rest
  const systemMsgs = messages.filter(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');

  // Always keep the tail
  const tail = nonSystem.slice(-keepTail);
  const toCompact = nonSystem.slice(0, nonSystem.length - keepTail);

  if (toCompact.length === 0) return messages;

  // Build a naive summary from the compacted messages
  const summaryText = toCompact
    .map(m => `[${m.role}]: ${messageText(m)}`)
    .join('\n')
    .slice(0, summaryMaxChars);

  const summaryMsg: Message = {
    role: 'assistant',
    content: `[Earlier conversation summary]\n${summaryText}`,
  };

  return [...systemMsgs, summaryMsg, ...tail];
}

// ---------------------------------------------------------------------------
// Agent tool registration
// ---------------------------------------------------------------------------

import { toolRegistry } from './tools';

export function registerMemoryTools(): void {
  toolRegistry.registerTool({
    name: 'memory_set',
    description: 'Remember a key-value fact across sessions.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        value: { type: 'string', description: 'Value to remember' },
      },
      required: ['key', 'value'],
    },
    execute: async (p) => {
      memorySet(p.key as string, p.value as string);
      return { stored: true };
    },
  });

  toolRegistry.registerTool({
    name: 'memory_get',
    description: 'Retrieve a previously remembered fact by key.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
      },
      required: ['key'],
    },
    readOnly: true,
    execute: async (p) => ({ value: memoryGet(p.key as string) }),
  });

  toolRegistry.registerTool({
    name: 'memory_list',
    description: 'List all remembered facts.',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
    execute: async () => ({ entries: memoryList() }),
  });

  toolRegistry.registerTool({
    name: 'memory_delete',
    description: 'Delete a remembered fact by key.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key to delete' },
      },
      required: ['key'],
    },
    execute: async (p) => ({ deleted: memoryDelete(p.key as string) }),
  });
}
