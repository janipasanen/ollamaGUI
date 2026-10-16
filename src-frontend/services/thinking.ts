/**
 * Reasoning / thinking display preference (#659).
 *
 * Two persisted user choices about streaming reasoning traces:
 *   - showThinking       : whether reasoning is rendered at all (off silences it).
 *   - collapsedByDefault : whether a reasoning block starts collapsed.
 *
 * Both default to the "on" state when absent from localStorage, mirroring the
 * localStorage-toggle pattern used by the other settings services
 * (autoCommit, agentAutonomy, theme, …).
 */

const SHOW_KEY = 'ollama_gui_show_thinking';
const COLLAPSE_KEY = 'ollama_gui_thinking_collapsed_by_default';

/** Whether reasoning traces should be rendered at all. Defaults to on. */
export function loadShowThinking(): boolean {
  try { return localStorage.getItem(SHOW_KEY) !== 'false'; } catch { return true; }
}

/** Persist whether reasoning traces should be rendered. */
export function saveShowThinking(on: boolean): void {
  try { localStorage.setItem(SHOW_KEY, on ? 'true' : 'false'); } catch { /* ignore */ }
}

/** Whether a reasoning block should start collapsed. Defaults to collapsed. */
export function loadThinkingCollapsedByDefault(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) !== 'false'; } catch { return true; }
}

/** Persist whether reasoning blocks start collapsed. */
export function saveThinkingCollapsedByDefault(on: boolean): void {
  try { localStorage.setItem(COLLAPSE_KEY, on ? 'true' : 'false'); } catch { /* ignore */ }
}
