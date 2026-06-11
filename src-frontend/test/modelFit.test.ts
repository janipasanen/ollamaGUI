import { describe, it, expect } from 'vitest';
import { classifyFit, fitLabel, formatBytes } from '../services/modelFit';

const GB = 1_000_000_000;

describe('model fit classification (#147)', () => {
  it('a small model on plenty of RAM is ok', () => {
    expect(classifyFit(2 * GB, 16 * GB)).toBe('ok');
  });

  it('a model near the memory ceiling is tight', () => {
    // needed = 4.5*1.2 + 1 = 6.4 GB; /8 = 0.8 → tight
    expect(classifyFit(4.5 * GB, 8 * GB)).toBe('tight');
  });

  it('a model far larger than available memory is risky', () => {
    expect(classifyFit(30 * GB, 8 * GB)).toBe('risky');
    expect(classifyFit(8 * GB, 8 * GB)).toBe('risky');
  });

  it('missing model size or memory classifies as unknown (no throw)', () => {
    expect(classifyFit(undefined, 8 * GB)).toBe('unknown');
    expect(classifyFit(4 * GB, undefined)).toBe('unknown');
    expect(classifyFit(undefined, undefined)).toBe('unknown');
  });

  it('fitLabel and formatBytes render sensibly', () => {
    expect(fitLabel('ok')).toMatch(/comfort/i);
    expect(fitLabel('unknown')).toMatch(/unknown/i);
    expect(formatBytes(2 * GB)).toBe('2.0 GB');
    expect(formatBytes(undefined)).toBe('—');
  });
});
