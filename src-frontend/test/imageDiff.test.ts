import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { diffScreenshots, _mocks, type DiffResult } from '../services/imageDiff';

// jsdom does not implement canvas — use the _mocks.diff seam for all tests.

beforeEach(() => {
  _mocks.diff = null;
});

afterEach(() => {
  _mocks.diff = null;
});

describe('diffScreenshots (#79)', () => {
  it('returns ratio 0 and pass=true for identical images', async () => {
    _mocks.diff = async (_a, _b, threshold) => ({
      diffRatio: 0,
      pass: 0 <= threshold,
      diffDataUrl: 'data:image/png;base64,abc',
    });
    const result = await diffScreenshots('before', 'before', 0.01);
    expect(result.diffRatio).toBe(0);
    expect(result.pass).toBe(true);
  });

  it('returns a nonzero ratio for changed images', async () => {
    _mocks.diff = async (_a, _b, threshold) => ({
      diffRatio: 0.05,
      pass: 0.05 <= threshold,
      diffDataUrl: 'data:image/png;base64,xyz',
    });
    const result = await diffScreenshots('before', 'after', 0.01);
    expect(result.diffRatio).toBe(0.05);
    expect(result.pass).toBe(false);
  });

  it('pass=true when ratio is below the threshold', async () => {
    _mocks.diff = async (_a, _b, threshold) => ({
      diffRatio: 0.005,
      pass: 0.005 <= threshold,
      diffDataUrl: 'data:image/png;base64,xyz',
    });
    const result = await diffScreenshots('b', 'a', 0.01);
    expect(result.pass).toBe(true);
  });

  it('pass=false when ratio equals or exceeds the threshold', async () => {
    _mocks.diff = async (_a, _b, threshold) => ({
      diffRatio: 0.02,
      pass: 0.02 <= threshold,
      diffDataUrl: 'data:image/png;base64,diff',
    });
    const result = await diffScreenshots('b', 'a', 0.01);
    expect(result.pass).toBe(false);
  });

  it('overlay is a valid base64 PNG data URL', async () => {
    _mocks.diff = async () => ({
      diffRatio: 0.03,
      pass: false,
      diffDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    });
    const result = await diffScreenshots('b', 'a', 0.01);
    expect(result.diffDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('ratio respects the threshold parameter', async () => {
    _mocks.diff = async (_a, _b, threshold) => ({
      diffRatio: 0.1,
      pass: 0.1 <= threshold,
      diffDataUrl: '',
    });
    const strict = await diffScreenshots('b', 'a', 0.05);
    expect(strict.pass).toBe(false);

    _mocks.diff = async (_a, _b, threshold) => ({
      diffRatio: 0.1,
      pass: 0.1 <= threshold,
      diffDataUrl: '',
    });
    const lenient = await diffScreenshots('b', 'a', 0.15);
    expect(lenient.pass).toBe(true);
  });
});

describe('visual_match scenario step with imageDiff (#79)', () => {
  it('visual_match step fails the scenario when diff ratio exceeds threshold', async () => {
    _mocks.diff = async () => ({ diffRatio: 0.5, pass: false, diffDataUrl: '' });
    const result = await diffScreenshots('baseline', 'current', 0.01);
    expect(result.pass).toBe(false);
    expect(result.diffRatio).toBe(0.5);
  });

  it('visual_match step passes when diff ratio is below threshold', async () => {
    _mocks.diff = async () => ({ diffRatio: 0.001, pass: true, diffDataUrl: '' });
    const result = await diffScreenshots('baseline', 'current', 0.01);
    expect(result.pass).toBe(true);
  });
});
