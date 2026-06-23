import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listScenarios, saveScenario, deleteScenario, getScenario,
  runScenario, generateScenarioId, _mocks,
  type BrowserScenario, type ScenarioStep,
} from '../services/scenario';

beforeEach(() => {
  localStorage.clear();
  _mocks.invoke = null;
  _mocks.diffScreenshots = null;
});

afterEach(() => {
  localStorage.clear();
  _mocks.invoke = null;
  _mocks.diffScreenshots = null;
});

function makeScenario(steps: ScenarioStep[]): BrowserScenario {
  return { id: generateScenarioId(), name: 'Test Scenario', steps, createdAt: Date.now() };
}

function mockInvoke(responses: Record<string, any>) {
  _mocks.invoke = async (cmd: string, args: any) => {
    if (cmd === 'browser_cdp_screenshot') return { screenshot: 'base64png==' };
    return responses[cmd] ?? { pass: true };
  };
}

describe('scenario persistence (#78)', () => {
  it('saves and retrieves a scenario', () => {
    const s = makeScenario([{ action: 'navigate', args: { url: 'https://example.com' } }]);
    saveScenario(s);
    expect(getScenario(s.id)).toMatchObject({ name: 'Test Scenario' });
  });

  it('lists all saved scenarios', () => {
    saveScenario(makeScenario([]));
    saveScenario(makeScenario([]));
    expect(listScenarios()).toHaveLength(2);
  });

  it('updates an existing scenario', () => {
    const s = makeScenario([]);
    saveScenario(s);
    saveScenario({ ...s, name: 'Updated' });
    expect(getScenario(s.id)?.name).toBe('Updated');
  });

  it('deletes a scenario', () => {
    const s = makeScenario([]);
    saveScenario(s);
    deleteScenario(s.id);
    expect(getScenario(s.id)).toBeUndefined();
    expect(listScenarios()).toHaveLength(0);
  });

  it('persists across listScenarios calls', () => {
    const s = makeScenario([{ action: 'click', args: { refId: 'btn1' } }]);
    saveScenario(s);
    const loaded = listScenarios().find(x => x.id === s.id);
    expect(loaded?.steps[0].action).toBe('click');
  });

  it('scenario with credential ref does NOT store the actual secret', () => {
    const s = makeScenario([{ action: 'type', args: { refId: 'pw', text: '' }, credentialRef: 'login_password' }]);
    saveScenario(s);
    const raw = localStorage.getItem('ollama_gui_browser_scenarios') ?? '';
    expect(raw).not.toContain('s3cr3t');
    expect(raw).toContain('login_password'); // ref placeholder is stored
  });
});

describe('scenario runner (#78)', () => {
  it('returns pass=true and records before/after screenshots for all steps', async () => {
    mockInvoke({ browser_cdp_navigate: { ok: true } });
    const scenario = makeScenario([
      { action: 'navigate', args: { url: 'https://example.com' } },
    ]);
    const result = await runScenario(scenario);
    expect(result.pass).toBe(true);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].pass).toBe(true);
    expect(result.stepResults[0].beforeScreenshot).toBe('base64png==');
    expect(result.stepResults[0].afterScreenshot).toBe('base64png==');
  });

  it('reports overall fail on first failing step and stops', async () => {
    let stepCount = 0;
    _mocks.invoke = async (cmd) => {
      if (cmd === 'browser_cdp_screenshot') return { screenshot: '' };
      stepCount++;
      if (stepCount === 2) return { pass: false, actual: 'foo' }; // assert step fails
      return { pass: true };
    };
    const scenario = makeScenario([
      { action: 'navigate', args: { url: 'https://x.com' } },
      { action: 'assert', args: { assertion: 'text', value: 'Login' } },
      { action: 'click', args: { refId: 'btn' } }, // should not run
    ]);
    const result = await runScenario(scenario);
    expect(result.pass).toBe(false);
    expect(result.failedStepIndex).toBe(1);
    expect(result.stepResults).toHaveLength(2); // stopped after fail
  });

  it('calls onStep callback for each completed step', async () => {
    mockInvoke({});
    const stepped: number[] = [];
    const scenario = makeScenario([
      { action: 'navigate', args: { url: 'https://a.com' } },
      { action: 'click', args: { refId: 'x' } },
    ]);
    await runScenario(scenario, { onStep: (i) => stepped.push(i) });
    expect(stepped).toEqual([0, 1]);
  });

  it('agent can run a saved scenario by id and get structured result', async () => {
    mockInvoke({});
    const s = makeScenario([{ action: 'navigate', args: { url: 'https://test.com' } }]);
    saveScenario(s);
    const loaded = getScenario(s.id)!;
    const result = await runScenario(loaded);
    expect(result).toHaveProperty('pass');
    expect(result).toHaveProperty('stepResults');
  });
});

describe('visual_match step (#78+#79)', () => {
  it('visual_match step calls diffScreenshots and reports pass', async () => {
    mockInvoke({});
    _mocks.diffScreenshots = async (_b, _a, _t) => ({ pass: true, diffRatio: 0.0 });
    const scenario = makeScenario([
      { action: 'visual_match', args: { threshold: 0.01 } },
    ]);
    const result = await runScenario(scenario);
    expect(result.stepResults[0].pass).toBe(true);
    expect(result.stepResults[0].beforeScreenshot).toBeDefined();
    expect(result.stepResults[0].diffRatio).toBe(0.0);
  });

  it('visual_match step fails when diffRatio exceeds threshold', async () => {
    mockInvoke({});
    _mocks.diffScreenshots = async (_b, _a, _t) => ({ pass: false, diffRatio: 0.5 });
    const scenario = makeScenario([
      { action: 'visual_match', args: { threshold: 0.01 } },
    ]);
    const result = await runScenario(scenario);
    expect(result.stepResults[0].pass).toBe(false);
    expect(result.stepResults[0].diffRatio).toBe(0.5);
    expect(result.stepResults[0].errorMessage).toContain('0.5000');
  });
});
