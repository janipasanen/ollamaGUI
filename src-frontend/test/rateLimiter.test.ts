import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  recordFailure,
  recordSuccess,
  isSuspicious,
  failureCount,
  resetRateLimiter,
  _clock,
} from '../services/rateLimiter';

let nowValue = 1_000_000;
beforeEach(() => {
  resetRateLimiter();
  nowValue = 1_000_000;
  _clock.now = () => nowValue;
});

describe('checkRateLimit (#35)', () => {
  it('allows events under the limit', () => {
    const r = checkRateLimit('k', 'oauth');
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(9); // oauth default limit 10
  });

  it('blocks once the limit is exceeded within the window', () => {
    for (let i = 0; i < 10; i++) checkRateLimit('k', 'oauth');
    const r = checkRateLimit('k', 'oauth');
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('frees up after the window slides past old events', () => {
    for (let i = 0; i < 10; i++) checkRateLimit('k', 'oauth');
    expect(checkRateLimit('k', 'oauth').allowed).toBe(false);
    nowValue += 61_000; // advance beyond the 60s window
    expect(checkRateLimit('k', 'oauth').allowed).toBe(true);
  });

  it('tracks separate keys independently', () => {
    for (let i = 0; i < 10; i++) checkRateLimit('a', 'oauth');
    expect(checkRateLimit('a', 'oauth').allowed).toBe(false);
    expect(checkRateLimit('b', 'oauth').allowed).toBe(true);
  });

  it('honors override options', () => {
    expect(checkRateLimit('k', 'oauth', { limit: 2, windowMs: 1000 }).allowed).toBe(true);
    expect(checkRateLimit('k', 'oauth', { limit: 2, windowMs: 1000 }).allowed).toBe(true);
    expect(checkRateLimit('k', 'oauth', { limit: 2, windowMs: 1000 }).allowed).toBe(false);
  });

  it('uses mcp-http defaults (higher limit)', () => {
    const r = checkRateLimit('m', 'mcp-http');
    expect(r.remaining).toBe(119); // mcp-http default limit 120
  });
});

describe('suspicious-activity monitoring (#35)', () => {
  it('counts consecutive failures', () => {
    expect(recordFailure('user')).toBe(1);
    expect(recordFailure('user')).toBe(2);
    expect(failureCount('user')).toBe(2);
  });

  it('flags suspicious after threshold failures', () => {
    for (let i = 0; i < 5; i++) recordFailure('user');
    expect(isSuspicious('user')).toBe(true);
  });

  it('is not suspicious below threshold', () => {
    recordFailure('user');
    recordFailure('user');
    expect(isSuspicious('user')).toBe(false);
  });

  it('resets the streak on success', () => {
    for (let i = 0; i < 5; i++) recordFailure('user');
    recordSuccess('user');
    expect(failureCount('user')).toBe(0);
    expect(isSuspicious('user')).toBe(false);
  });

  it('honors a custom threshold', () => {
    recordFailure('user');
    recordFailure('user');
    expect(isSuspicious('user', 2)).toBe(true);
  });
});
