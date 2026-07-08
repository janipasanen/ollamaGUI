/**
 * Plan/todo store + `update_plan` agent tool (#239).
 *
 * Mirrors the plan surfaces in agentic GUIs/TUIs (Codex CLI `update_plan`,
 * Claude Code `TodoWrite`): the model publishes a structured list of steps with
 * statuses, and the UI renders a live checklist. The tool only mutates plan UI
 * state (never the filesystem), so it is registered as read-only and does not
 * require per-call approval.
 */
import { toolRegistry } from './tools';

export type PlanStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanItem {
  step: string;
  status: PlanStatus;
}

export interface PlanInputItem {
  step: string;
  status?: PlanStatus;
}

type Listener = (plan: PlanItem[]) => void;

let _plan: PlanItem[] = [];
const _listeners = new Set<Listener>();

function normalize(items: PlanInputItem[]): PlanItem[] {
  return items.map(item => {
    const status: PlanStatus =
      item.status === 'in_progress' || item.status === 'completed' ? item.status : 'pending';
    return { step: String(item.step ?? '').trim(), status };
  }).filter(item => item.step.length > 0);
}

function emit(): void {
  const snapshot = _plan.slice();
  for (const cb of _listeners) cb(snapshot);
}

/** Current plan (a defensive copy). */
export function getPlan(): PlanItem[] {
  return _plan.slice();
}

/** Replace the whole plan and notify subscribers. */
export function setPlan(items: PlanInputItem[]): PlanItem[] {
  _plan = normalize(items);
  emit();
  return _plan.slice();
}

/**
 * Incrementally update the plan by step text: for each incoming item, update the
 * matching existing step's status, or append it if new. Steps absent from the
 * update are left untouched.
 */
export function updatePlan(items: PlanInputItem[]): PlanItem[] {
  const incoming = normalize(items);
  const next = _plan.slice();
  for (const item of incoming) {
    const idx = next.findIndex(p => p.step === item.step);
    if (idx >= 0) next[idx] = { ...next[idx], status: item.status };
    else next.push(item);
  }
  _plan = next;
  emit();
  return _plan.slice();
}

/** Clear the plan and notify subscribers. */
export function clearPlan(): void {
  _plan = [];
  emit();
}

/** Subscribe to plan changes. Returns an unsubscribe function. */
export function subscribe(cb: Listener): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/** Test seam: reset to a pristine state. */
export function _resetPlanStore(): void {
  _plan = [];
  _listeners.clear();
}

const PLAN_TOOL_NAME = 'update_plan';

/** Register the `update_plan` agent tool (idempotent). */
export function registerPlanTool(): void {
  if (toolRegistry.getTool(PLAN_TOOL_NAME)) return;
  toolRegistry.registerTool({
    name: PLAN_TOOL_NAME,
    description:
      'Update the task plan shown to the user as a live checklist. Pass the FULL list of steps each call, each with a status of "pending", "in_progress", or "completed". At most one step should be "in_progress" at a time. Use this to show progress on multi-step tasks.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        plan: {
          type: 'array',
          description: 'The full plan: an array of { step, status } objects.',
          items: {
            type: 'object',
            properties: {
              step: { type: 'string', description: 'A short description of the task step.' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Status of the step.' },
            },
            required: ['step'],
          },
        },
      },
      required: ['plan'],
    },
    execute: async (params: unknown) => {
      const args = params as { plan?: PlanInputItem[] };
      if (!Array.isArray(args?.plan)) {
        return { error: 'update_plan requires a "plan" array' };
      }
      const updated = setPlan(args.plan);
      return { ok: true, plan: updated };
    },
  });
}

export function unregisterPlanTool(): void {
  toolRegistry.unregisterTool(PLAN_TOOL_NAME);
}
