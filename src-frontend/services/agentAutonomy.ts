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
 * SmartApprove (#146) — when true (in 'ask' level), read-only tools are
 * approved automatically; only mutating tools prompt the user.
 */

export type AutonomyLevel = 'plan' | 'ask' | 'auto';

export interface AgentAutonomySettings {
  level: AutonomyLevel;
  maxIterations: number;
  readOnly: boolean;
  smartApprove: boolean;
}

const STORAGE_KEY = 'ollama_gui_agent_autonomy';

const DEFAULTS: AgentAutonomySettings = {
  level: 'ask',
  maxIterations: 20,
  readOnly: false,
  smartApprove: false,
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...settings }));
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

export function isSmartApproveEnabled(): boolean {
  return loadSettings().smartApprove;
}

export function setSmartApproveEnabled(on: boolean): void {
  saveSettings({ smartApprove: on });
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
  const settings = loadSettings();
  if (settings.level === 'auto') return false;
  if (settings.level === 'ask') {
    // SmartApprove: skip the prompt for read-only tools
    if (settings.smartApprove && toolIsReadOnly) return false;
    return true;
  }
  // plan — execution proceeds step-by-step; ask before each non-read-only step
  return !toolIsReadOnly;
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
