/**
 * Reusable prompt library (#97).
 * Named prompt snippets stored in localStorage; selecting one inserts the body
 * into the chat input.
 */
const STORAGE_KEY = 'ollama_gui_prompts';

export interface SavedPrompt {
  id: string;
  name: string;
  body: string;
  createdAt: number;
}

// ── Persistence ───────────────────────────────────────────────────────────────

export function loadPrompts(): SavedPrompt[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}

export function savePrompts(prompts: SavedPrompt[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
}

export function addPrompt(p: Omit<SavedPrompt, 'id' | 'createdAt'>): SavedPrompt {
  const prompt: SavedPrompt = { ...p, id: crypto.randomUUID(), createdAt: Date.now() };
  savePrompts([...loadPrompts(), prompt]);
  return prompt;
}

export function updatePrompt(id: string, patch: Partial<Pick<SavedPrompt, 'name' | 'body'>>): void {
  savePrompts(loadPrompts().map(p => p.id === id ? { ...p, ...patch } : p));
}

export function removePrompt(id: string): void {
  savePrompts(loadPrompts().filter(p => p.id !== id));
}

export function findPrompt(id: string): SavedPrompt | undefined {
  return loadPrompts().find(p => p.id === id);
}
