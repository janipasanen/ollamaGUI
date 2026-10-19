/**
 * Model fallback chain (#669) — classification and configuration.
 *
 * The rule under test: switch only when the *model* is the problem. A context
 * overflow, a bad request or an auth failure must not silently move the run to
 * another model, because that hides the real error.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyFailure,
  fallbackCandidates,
  switchReason,
  loadFallbackModels,
  saveFallbackModels,
  FALLBACK_MODELS_KEY,
} from '../services/modelFallback';

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

beforeEach(() => { localStorage.clear(); });

describe('classifyFailure', () => {
  it('treats a missing model as model-scoped', () => {
    expect(classifyFailure(httpError(404, "model 'llama3' not found"))).toBe('model');
    expect(classifyFailure(new Error('no such model: qwen9'))).toBe('model');
  });

  it('treats a load failure or daemon 500 as model-scoped', () => {
    expect(classifyFailure(httpError(500, 'failed to load model: out of memory'))).toBe('model');
    expect(classifyFailure(new Error('CUDA error: out of memory'))).toBe('model');
    expect(classifyFailure(httpError(503, 'model is loading'))).toBe('model');
  });

  it('treats a dead host as model-scoped (the fallback may live elsewhere)', () => {
    expect(classifyFailure(new TypeError('Failed to fetch'))).toBe('model');
  });

  it('never switches on an abort', () => {
    const e = new Error('The operation was aborted');
    e.name = 'AbortError';
    expect(classifyFailure(e)).toBe('abort');
  });

  it('never switches on auth failures', () => {
    expect(classifyFailure(httpError(401, 'Unauthorized'))).toBe('auth');
    expect(classifyFailure(new Error('invalid api key'))).toBe('auth');
  });

  it('never switches on request-scoped failures', () => {
    expect(classifyFailure(new Error('context length exceeded'))).toBe('request');
    expect(classifyFailure(httpError(413, 'too large'))).toBe('request');
    expect(classifyFailure(new Error('invalid tool schema'))).toBe('request');
  });

  it('defaults to request when the cause is unknown', () => {
    expect(classifyFailure(new Error('something odd happened'))).toBe('request');
    expect(classifyFailure(undefined)).toBe('request');
  });
});

describe('fallbackCandidates', () => {
  it('keeps order, drops the current model and duplicates', () => {
    expect(fallbackCandidates(['a', 'b', 'a', ' c ', '', 'd'], 'b')).toEqual(['a', 'c', 'd']);
  });

  it('returns nothing when no chain is configured', () => {
    expect(fallbackCandidates(undefined, 'a')).toEqual([]);
    expect(fallbackCandidates([], 'a')).toEqual([]);
  });
});

describe('switchReason', () => {
  it('includes the status and collapses whitespace', () => {
    expect(switchReason(httpError(500, 'failed   to load\nmodel'))).toBe('HTTP 500: failed to load model');
  });

  it('truncates long messages', () => {
    expect(switchReason(new Error('x'.repeat(400))).length).toBeLessThanOrEqual(166);
  });
});

describe('fallback settings', () => {
  it('round-trips through localStorage', () => {
    saveFallbackModels(['a', 'b']);
    expect(localStorage.getItem(FALLBACK_MODELS_KEY)).toBe('["a","b"]');
    expect(loadFallbackModels()).toEqual(['a', 'b']);
  });

  it('ignores malformed storage', () => {
    localStorage.setItem(FALLBACK_MODELS_KEY, 'not json');
    expect(loadFallbackModels()).toEqual([]);
    localStorage.setItem(FALLBACK_MODELS_KEY, '{"a":1}');
    expect(loadFallbackModels()).toEqual([]);
  });
});
