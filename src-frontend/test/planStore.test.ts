import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getPlan, setPlan, updatePlan, clearPlan, subscribe,
  registerPlanTool, unregisterPlanTool, _resetPlanStore,
} from '../services/planStore';
import { toolRegistry } from '../services/tools';

beforeEach(() => {
  _resetPlanStore();
  unregisterPlanTool();
});

afterEach(() => {
  _resetPlanStore();
  unregisterPlanTool();
});

describe('planStore (#239)', () => {
  it('setPlan replaces the plan and normalizes statuses', () => {
    const plan = setPlan([
      { step: 'A', status: 'completed' },
      { step: 'B', status: 'in_progress' },
      { step: 'C' },
      { step: 'D', status: 'bogus' as any },
      { step: '  ' },
    ]);
    expect(plan).toEqual([
      { step: 'A', status: 'completed' },
      { step: 'B', status: 'in_progress' },
      { step: 'C', status: 'pending' },
      { step: 'D', status: 'pending' },
    ]);
    expect(getPlan()).toEqual(plan);
  });

  it('clearPlan empties the plan', () => {
    setPlan([{ step: 'A' }]);
    clearPlan();
    expect(getPlan()).toEqual([]);
  });

  it('updatePlan merges by step text and appends new steps', () => {
    setPlan([
      { step: 'A', status: 'completed' },
      { step: 'B', status: 'pending' },
    ]);
    const plan = updatePlan([
      { step: 'B', status: 'in_progress' },
      { step: 'C', status: 'pending' },
    ]);
    expect(plan).toEqual([
      { step: 'A', status: 'completed' },
      { step: 'B', status: 'in_progress' },
      { step: 'C', status: 'pending' },
    ]);
  });

  it('subscribers are notified on set/update/clear and unsubscribe stops calls', () => {
    const calls: number[] = [];
    const unsub = subscribe(() => calls.push(calls.length));
    setPlan([{ step: 'A' }]);
    updatePlan([{ step: 'A', status: 'completed' }]);
    clearPlan();
    unsub();
    setPlan([{ step: 'B' }]);
    expect(calls).toEqual([0, 1, 2]);
  });
});

describe('update_plan tool (#239)', () => {
  beforeEach(() => registerPlanTool());

  it('is registered as read-only', () => {
    const tool = toolRegistry.getTool('update_plan');
    expect(tool).toBeDefined();
    expect(tool!.readOnly).toBe(true);
  });

  it('replace: a full plan array sets the store and returns it', async () => {
    const res = await toolRegistry.getTool('update_plan')!.execute({
      plan: [
        { step: 'Read file', status: 'completed' },
        { step: 'Edit file', status: 'in_progress' },
        { step: 'Verify', status: 'pending' },
      ],
    });
    expect(res).toMatchObject({ ok: true });
    expect(res.plan).toHaveLength(3);
    expect(getPlan()[1]).toEqual({ step: 'Edit file', status: 'in_progress' });
  });

  it('rejects a non-array plan with an error result (no throw)', async () => {
    const res = await toolRegistry.getTool('update_plan')!.execute({ plan: 'nope' });
    expect(res).toMatchObject({ error: expect.any(String) });
    expect(getPlan()).toEqual([]);
  });

  it('registerPlanTool is idempotent', () => {
    registerPlanTool();
    registerPlanTool();
    // Still exactly one tool by that name.
    expect(toolRegistry.getTool('update_plan')).toBeDefined();
  });
});
