import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSettings, saveSettings, getAutonomyLevel, setAutonomyLevel,
  getMaxIterations, setMaxIterations, isReadOnlyMode, setReadOnlyMode,
  isSmartApproveEnabled, setSmartApproveEnabled,
  isPlanMode, shouldAskBeforeToolUse, isBlockedByReadOnlyMode,
  IterationCounter,
  type AutonomyLevel,
} from '../services/agentAutonomy';

beforeEach(() => {
  localStorage.clear();
});

describe('defaults (#88)', () => {
  it('defaults to ask level', () => {
    expect(getAutonomyLevel()).toBe('ask');
  });

  it('defaults maxIterations to 20', () => {
    expect(getMaxIterations()).toBe(20);
  });

  it('defaults readOnly to false', () => {
    expect(isReadOnlyMode()).toBe(false);
  });

  it('defaults smartApprove to false', () => {
    expect(isSmartApproveEnabled()).toBe(false);
  });
});

describe('setAutonomyLevel (#88)', () => {
  it.each([['plan'], ['ask'], ['auto']] as AutonomyLevel[][])('persists %s', (level: AutonomyLevel) => {
    setAutonomyLevel(level);
    expect(getAutonomyLevel()).toBe(level);
  });
});

describe('maxIterations (#89)', () => {
  it('clamps below 1 to 1', () => {
    setMaxIterations(0);
    expect(getMaxIterations()).toBe(1);
  });

  it('clamps above 200 to 200', () => {
    setMaxIterations(999);
    expect(getMaxIterations()).toBe(200);
  });

  it('saves a valid value', () => {
    setMaxIterations(50);
    expect(getMaxIterations()).toBe(50);
  });
});

describe('readOnly + smartApprove (#146)', () => {
  it('setReadOnlyMode persists the flag', () => {
    setReadOnlyMode(true);
    expect(isReadOnlyMode()).toBe(true);
    setReadOnlyMode(false);
    expect(isReadOnlyMode()).toBe(false);
  });

  it('setSmartApproveEnabled persists the flag', () => {
    setSmartApproveEnabled(true);
    expect(isSmartApproveEnabled()).toBe(true);
  });
});

describe('isPlanMode (#88)', () => {
  it('returns true only in plan level', () => {
    setAutonomyLevel('plan');
    expect(isPlanMode()).toBe(true);
    setAutonomyLevel('ask');
    expect(isPlanMode()).toBe(false);
    setAutonomyLevel('auto');
    expect(isPlanMode()).toBe(false);
  });
});

describe('shouldAskBeforeToolUse (#88, #146)', () => {
  it('ask level + non-readOnly tool → ask', () => {
    setAutonomyLevel('ask');
    setSmartApproveEnabled(false);
    expect(shouldAskBeforeToolUse(false)).toBe(true);
  });

  it('ask level + readOnly tool + smartApprove → skip ask', () => {
    setAutonomyLevel('ask');
    setSmartApproveEnabled(true);
    expect(shouldAskBeforeToolUse(true)).toBe(false);
  });

  it('ask level + readOnly tool but no smartApprove → ask', () => {
    setAutonomyLevel('ask');
    setSmartApproveEnabled(false);
    expect(shouldAskBeforeToolUse(true)).toBe(true);
  });

  it('auto level → never ask', () => {
    setAutonomyLevel('auto');
    expect(shouldAskBeforeToolUse(false)).toBe(false);
    expect(shouldAskBeforeToolUse(true)).toBe(false);
  });

  it('plan level + readOnly tool → skip ask (read-only is safe)', () => {
    setAutonomyLevel('plan');
    expect(shouldAskBeforeToolUse(true)).toBe(false);
  });

  it('plan level + non-readOnly tool → ask', () => {
    setAutonomyLevel('plan');
    expect(shouldAskBeforeToolUse(false)).toBe(true);
  });
});

describe('isBlockedByReadOnlyMode (#146)', () => {
  it('readOnly mode + non-readOnly tool → blocked', () => {
    setReadOnlyMode(true);
    expect(isBlockedByReadOnlyMode(false)).toBe(true);
  });

  it('readOnly mode + readOnly tool → allowed', () => {
    setReadOnlyMode(true);
    expect(isBlockedByReadOnlyMode(true)).toBe(false);
  });

  it('not in readOnly mode → always allowed', () => {
    setReadOnlyMode(false);
    expect(isBlockedByReadOnlyMode(false)).toBe(false);
    expect(isBlockedByReadOnlyMode(true)).toBe(false);
  });
});

describe('IterationCounter (#89)', () => {
  it('starts at 0', () => {
    const c = new IterationCounter();
    expect(c.current).toBe(0);
  });

  it('increments on each call', () => {
    const c = new IterationCounter();
    expect(c.increment()).toBe(1);
    expect(c.increment()).toBe(2);
    expect(c.current).toBe(2);
  });

  it('resets to 0', () => {
    const c = new IterationCounter();
    c.increment();
    c.reset();
    expect(c.current).toBe(0);
  });

  it('isAtLimit returns false below the limit', () => {
    const c = new IterationCounter();
    c.increment(); // 1
    expect(c.isAtLimit(5)).toBe(false);
  });

  it('isAtLimit returns true at the limit', () => {
    const c = new IterationCounter();
    for (let i = 0; i < 5; i++) c.increment();
    expect(c.isAtLimit(5)).toBe(true);
  });

  it('uses getMaxIterations() when no explicit limit passed', () => {
    setMaxIterations(3);
    const c = new IterationCounter();
    c.increment(); c.increment(); c.increment();
    expect(c.isAtLimit()).toBe(true);
  });
});
