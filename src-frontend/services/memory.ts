/**
 * Cross-session memory (#95).
 *
 * MemoryEntry stores facts/preferences the user or agent wants remembered
 * across sessions. Scope 'global' applies everywhere; a projectId scope
 * applies only inside that project.
 *
 * Entries are composed into the system prompt before the user's system prompt
 * so the model treats them as persistent context.
 */

const MEMORY_KEY = 'ollama_gui_memory';

export interface MemoryEntry {
  id: string;
  text: string;
  scope: 'global' | string; // 'global' or projectId
  createdAt: number;
}

// ── Persistence ───────────────────────────────────────────────────────────────

export function loadMemory(): MemoryEntry[] {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '[]'); } catch { return []; }
}

export function saveMemory(entries: MemoryEntry[]): void {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(entries));
}

export function addMemoryEntry(text: string, scope: string = 'global'): MemoryEntry {
  const entry: MemoryEntry = { id: crypto.randomUUID(), text, scope, createdAt: Date.now() };
  saveMemory([...loadMemory(), entry]);
  return entry;
}

export function removeMemoryEntry(id: string): void {
  saveMemory(loadMemory().filter(e => e.id !== id));
}

export function updateMemoryEntry(id: string, patch: Partial<Pick<MemoryEntry, 'text' | 'scope'>>): void {
  saveMemory(loadMemory().map(e => e.id === id ? { ...e, ...patch } : e));
}

/** Return entries relevant to the given project (global + project-scoped). */
export function getRelevantEntries(projectId?: string): MemoryEntry[] {
  return loadMemory().filter(e => e.scope === 'global' || (projectId && e.scope === projectId));
}

/** Compose memory entries into a system-prompt injection block. */
export function composeMemoryBlock(projectId?: string, maxChars = 2000): string {
  const entries = getRelevantEntries(projectId);
  if (entries.length === 0) return '';
  let block = '--- Persistent Memory ---\n';
  let used = block.length;
  for (const e of entries) {
    const line = `- ${e.text}\n`;
    if (used + line.length > maxChars) break;
    block += line;
    used += line.length;
  }
  block += '-------------------------\n';
  return block;
}
