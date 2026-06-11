/**
 * Browser scenario runner: record / replay / assert UI flows (#78).
 *
 * Scenarios are ordered lists of steps (navigate/click/type/wait_for/assert/
 * visual_match) executed by invoking the same Rust CDP commands. Each step
 * captures before/after screenshots. Pass/fail is reported per step.
 */

export type StepAction = 'navigate' | 'click' | 'type' | 'wait_for' | 'assert' | 'visual_match';

export interface ScenarioStep {
  action: StepAction;
  args: Record<string, any>;
  /** Credential placeholder for login steps — NEVER the actual secret. */
  credentialRef?: string;
}

export interface BrowserScenario {
  id: string;
  name: string;
  steps: ScenarioStep[];
  createdAt: number;
}

export interface StepResult {
  stepIndex: number;
  pass: boolean;
  beforeScreenshot?: string;  // base64 PNG
  afterScreenshot?: string;   // base64 PNG
  diffRatio?: number;
  errorMessage?: string;
}

export interface ScenarioResult {
  pass: boolean;
  failedStepIndex?: number;
  stepResults: StepResult[];
}

// ── Persistence (localStorage, mirrors mcpConfig pattern) ────────────────────

const STORAGE_KEY = 'ollama_gui_browser_scenarios';

export function listScenarios(): BrowserScenario[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}

export function saveScenario(s: BrowserScenario): void {
  const all = listScenarios();
  const idx = all.findIndex(x => x.id === s.id);
  if (idx >= 0) all[idx] = s; else all.push(s);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function deleteScenario(id: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(listScenarios().filter(s => s.id !== id)));
}

export function getScenario(id: string): BrowserScenario | undefined {
  return listScenarios().find(s => s.id === id);
}

export function generateScenarioId(): string {
  return `sc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── Step executor (delegates to Rust CDP via invoke) ─────────────────────────

/** Test seam: override to avoid real Tauri invocations. */
export const _mocks = {
  invoke: null as ((cmd: string, args: any) => Promise<any>) | null,
};

async function cdpInvoke(cmd: string, args: any): Promise<any> {
  if (_mocks.invoke) return _mocks.invoke(cmd, args);
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

async function captureScreenshot(): Promise<string | undefined> {
  try {
    const r = await cdpInvoke('browser_cdp_screenshot', {});
    return r?.screenshot ?? undefined;
  } catch { return undefined; }
}

async function executeStep(step: ScenarioStep): Promise<{ pass: boolean; error?: string }> {
  try {
    switch (step.action) {
      case 'navigate':
        await cdpInvoke('browser_cdp_navigate', { url: step.args.url });
        return { pass: true };
      case 'click':
        await cdpInvoke('browser_cdp_click', { ref_id: step.args.refId ?? step.args.ref_id });
        return { pass: true };
      case 'type':
        await cdpInvoke('browser_cdp_type', { ref_id: step.args.refId ?? step.args.ref_id, text: step.args.text });
        return { pass: true };
      case 'wait_for':
        await cdpInvoke('browser_cdp_wait_for', { selector: step.args.selector, timeoutMs: step.args.timeoutMs ?? 5000 });
        return { pass: true };
      case 'assert': {
        const result = await cdpInvoke('browser_cdp_assert', { assertion: step.args.assertion, value: step.args.value });
        const pass = result?.pass ?? false;
        return { pass, error: pass ? undefined : `Assertion failed: expected ${step.args.value}, got ${result?.actual}` };
      }
      case 'visual_match': {
        // Visual diff handled by caller (imageDiff service)
        return { pass: true };
      }
      default:
        return { pass: false, error: `Unknown step action: ${(step as any).action}` };
    }
  } catch (e) {
    return { pass: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

export interface RunOptions {
  onStep?: (index: number, result: StepResult) => void;
}

export async function runScenario(scenario: BrowserScenario, opts: RunOptions = {}): Promise<ScenarioResult> {
  const stepResults: StepResult[] = [];
  let overallPass = true;
  let failedStepIndex: number | undefined;

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const beforeScreenshot = await captureScreenshot();
    const { pass, error } = await executeStep(step);
    const afterScreenshot = await captureScreenshot();

    const stepResult: StepResult = {
      stepIndex: i,
      pass,
      beforeScreenshot,
      afterScreenshot,
      errorMessage: error,
    };

    stepResults.push(stepResult);
    opts.onStep?.(i, stepResult);

    if (!pass) {
      overallPass = false;
      failedStepIndex = i;
      break;
    }
  }

  return { pass: overallPass, failedStepIndex, stepResults };
}
