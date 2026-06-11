/**
 * Model presets (#124): bundle base model + system prompt + generation params
 * + enabled tool names + MCP server IDs + knowledge collection IDs into a
 * single selectable "model". Persisted in localStorage.
 */
import type { GenerationOptions } from './ollama';

const STORAGE_KEY = 'model_presets';
const ACTIVE_KEY = 'active_preset_id';

export interface ModelPreset {
  id: string;
  name: string;
  /** Optional emoji/icon shown in the selector */
  icon?: string;
  /** Base model tag (e.g. 'ministral-3:3b') */
  baseModel: string;
  /** Optional connection id; undefined = default Ollama */
  connectionId?: string;
  systemPrompt: string;
  params: GenerationOptions;
  /** Tool names from toolRegistry that are enabled for this preset */
  toolNames: string[];
  /** MCP server IDs that are active for this preset */
  mcpServerIds: string[];
  /** Knowledge collection IDs bound to this preset (future use) */
  knowledgeCollectionIds: string[];
}

export function loadPresets(): ModelPreset[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}

export function savePresets(presets: ModelPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function addPreset(preset: Omit<ModelPreset, 'id'>): ModelPreset {
  const entry: ModelPreset = { ...preset, id: crypto.randomUUID() };
  const all = loadPresets();
  all.push(entry);
  savePresets(all);
  return entry;
}

export function updatePreset(id: string, patch: Partial<Omit<ModelPreset, 'id'>>): void {
  savePresets(loadPresets().map(p => p.id === id ? { ...p, ...patch } : p));
}

export function removePreset(id: string): void {
  savePresets(loadPresets().filter(p => p.id !== id));
  if (loadActivePresetId() === id) clearActivePreset();
}

export function loadActivePresetId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActivePreset(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else clearActivePreset();
}

export function clearActivePreset(): void {
  localStorage.removeItem(ACTIVE_KEY);
}

export function getActivePreset(): ModelPreset | null {
  const id = loadActivePresetId();
  if (!id) return null;
  return loadPresets().find(p => p.id === id) ?? null;
}

/**
 * Apply a preset's values to the given setters. Returns the resolved model
 * name (the preset's baseModel) for convenience.
 */
export function applyPreset(
  preset: ModelPreset,
  setters: {
    setModel: (m: string) => void;
    setSystemPrompt: (s: string) => void;
    setGenOptions: (o: GenerationOptions) => void;
  }
): string {
  setters.setModel(preset.baseModel);
  setters.setSystemPrompt(preset.systemPrompt);
  setters.setGenOptions(preset.params);
  return preset.baseModel;
}
