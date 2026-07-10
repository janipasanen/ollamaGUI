/**
 * Per-tool enable/disable configuration (#399, Claude Code parity).
 *
 * Users can disable individual built-in tools so the main agent no longer sees
 * them. The disabled set is persisted to localStorage. MCP tools keep their own
 * per-tool toggles; this service covers the built-in registry tools.
 */

import { toolRegistry } from './tools';

const STORAGE_KEY = 'ollama_gui_disabled_tools';

/** Load the persisted set of disabled tool names. */
export function loadDisabledTools(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/** Persist the disabled-tool set. */
export function saveDisabledTools(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore quota / privacy errors */
  }
}

/** True when `name` is currently enabled (not in the disabled set). */
export function isToolEnabled(name: string, disabled?: Set<string>): boolean {
  const set = disabled ?? loadDisabledTools();
  return !set.has(name);
}

/** Enable or disable a tool by name, persisting the change. Returns the new set. */
export function setToolEnabled(name: string, enabled: boolean): Set<string> {
  const set = loadDisabledTools();
  if (enabled) set.delete(name);
  else set.add(name);
  saveDisabledTools(set);
  return set;
}

/**
 * Derive the `toolFilter` array for the main agent: the names of all currently
 * registered tools that are NOT disabled.
 *
 * Returns `null` when nothing is disabled, so callers can omit `toolFilter`
 * entirely and preserve the default "expose everything" behaviour (and avoid
 * breaking sub-agent / no-filter test expectations).
 */
export function getEnabledToolFilter(disabled?: Set<string>): string[] | null {
  const set = disabled ?? loadDisabledTools();
  if (set.size === 0) return null;
  return toolRegistry.getAllTools().map(t => t.name).filter(n => !set.has(n));
}

/** Human-readable list of registered tools with their enabled state. */
export interface ToolStatus {
  name: string;
  description: string;
  enabled: boolean;
  readOnly: boolean;
}

export function listToolStatuses(disabled?: Set<string>): ToolStatus[] {
  const set = disabled ?? loadDisabledTools();
  return toolRegistry.getAllTools().map(t => ({
    name: t.name,
    description: t.description,
    enabled: !set.has(t.name),
    readOnly: t.readOnly ?? false,
  }));
}
