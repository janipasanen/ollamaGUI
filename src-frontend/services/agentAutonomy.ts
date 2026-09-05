/**
 * Agent autonomy levels, plan mode, and iteration limits (#88, #89, #146).
 *
 * Three levels:
 *   plan  — agent proposes a step-by-step plan; execution only begins after
 *            user approval.
 *   ask   — agent asks before each tool call that mutates state.
 *   auto  — agent runs without interruption up to `maxIterations`.
 *
 * readOnly mode (#146) — when true, any tool without `readOnly: true` in its
 * definition is blocked, regardless of autonomy level.
 *
 * Read-only tools NEVER prompt, at any level: reading a file cannot damage
 * anything, and prompting for reads made "autonomous" runs a modal treadmill.
 */

export type AutonomyLevel = 'plan' | 'ask' | 'auto';

export interface AgentAutonomySettings {
  level: AutonomyLevel;
  maxIterations: number;
  readOnly: boolean;
}

const STORAGE_KEY = 'ollama_gui_agent_autonomy';

const DEFAULTS: AgentAutonomySettings = {
  level: 'ask',
  maxIterations: 20,
  readOnly: false,
};

export function loadSettings(): AgentAutonomySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Partial<AgentAutonomySettings>): void {
  const current = loadSettings();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...settings })); } catch { /* quota */ }
}

export function getAutonomyLevel(): AutonomyLevel {
  return loadSettings().level;
}

export function setAutonomyLevel(level: AutonomyLevel): void {
  saveSettings({ level });
}

export function getMaxIterations(): number {
  return loadSettings().maxIterations;
}

export function setMaxIterations(n: number): void {
  saveSettings({ maxIterations: Math.max(1, Math.min(200, n)) });
}

export function isReadOnlyMode(): boolean {
  return loadSettings().readOnly;
}

export function setReadOnlyMode(on: boolean): void {
  saveSettings({ readOnly: on });
}

// ── Plan mode helpers ─────────────────────────────────────────────────────────

/**
 * Returns true if the agent should present a plan and wait for approval before
 * taking any tool-use step.
 */
export function isPlanMode(): boolean {
  return getAutonomyLevel() === 'plan';
}

/**
 * Determine whether the agent should prompt the user before using a tool.
 *
 * @param toolIsReadOnly  True if the tool's `readOnly` flag is set.
 */
export function shouldAskBeforeToolUse(toolIsReadOnly: boolean): boolean {
  // Reading never prompts — only mutating tools are gated, and only below 'auto'.
  if (toolIsReadOnly) return false;
  return loadSettings().level !== 'auto';
}

/**
 * Returns true when the tool should be blocked because readOnly mode is on and
 * the tool itself is not marked readOnly.
 */
export function isBlockedByReadOnlyMode(toolIsReadOnly: boolean): boolean {
  return isReadOnlyMode() && !toolIsReadOnly;
}

// ── Iteration counter ─────────────────────────────────────────────────────────

export class IterationCounter {
  private count = 0;

  reset(): void {
    this.count = 0;
  }

  increment(): number {
    return ++this.count;
  }

  get current(): number {
    return this.count;
  }

  isAtLimit(max?: number): boolean {
    const limit = max ?? getMaxIterations();
    return this.count >= limit;
  }
}
