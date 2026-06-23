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
  /** Override diffScreenshots for visual_match tests without loading imageDiff. */
  diffScreenshots: null as ((before: string, after: string, threshold: number) => Promise<{ pass: boolean; diffRatio: number }>) | null,
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
        // Requires before/after screenshots captured by the caller (runScenario).
        // The step receives them via step.args.before / step.args.after when the
        // runner passes them in; otherwise we capture fresh shots here as a fallback.
        const threshold: number = step.args.threshold ?? 0.01;
        const before: string | undefined = step.args.before;
        const after: string | undefined = step.args.after;
        if (!before || !after) {
          return { pass: false, error: 'visual_match: before/after screenshots not available for this step' };
        }
        const diffFn = _mocks.diffScreenshots
          ?? (await import('./imageDiff')).diffScreenshots;
        const diff = await diffFn(before, after, threshold);
        return {
          pass: diff.pass,
          error: diff.pass ? undefined : `Visual diff ratio ${diff.diffRatio.toFixed(4)} exceeds threshold ${threshold}`,
        };
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
    // For visual_match steps, inject the captured screenshots so the executor
    // can call diffScreenshots without needing its own capture calls.
    const enrichedStep: ScenarioStep = step.action === 'visual_match'
      ? { ...step, args: { ...step.args, before: beforeScreenshot, after: undefined } }
      : step;
    const { pass, error } = await executeStep(enrichedStep);
    const afterScreenshot = await captureScreenshot();
    // If this is a visual_match, re-run the diff with the actual after screenshot.
    let finalPass = pass;
    let finalError = error;
    let diffRatio: number | undefined;
    if (step.action === 'visual_match' && beforeScreenshot && afterScreenshot) {
      const diffFn = _mocks.diffScreenshots
        ?? (await import('./imageDiff')).diffScreenshots;
      const threshold: number = step.args.threshold ?? 0.01;
      const diff = await diffFn(beforeScreenshot, afterScreenshot, threshold);
      finalPass = diff.pass;
      diffRatio = diff.diffRatio;
      finalError = diff.pass ? undefined : `Visual diff ratio ${diff.diffRatio.toFixed(4)} exceeds threshold ${threshold}`;
    }

    const stepResult: StepResult = {
      stepIndex: i,
      pass: finalPass,
      beforeScreenshot,
      afterScreenshot,
      diffRatio,
      errorMessage: finalError,
    };

    stepResults.push(stepResult);
    opts.onStep?.(i, stepResult);

    if (!finalPass) {
      overallPass = false;
      failedStepIndex = i;
      break;
    }
  }

  return { pass: overallPass, failedStepIndex, stepResults };
}
