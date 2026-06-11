/**
 * Client-side rate limiting + suspicious-activity monitoring (#35).
 *
 * A sliding-window limiter guards sensitive client-initiated flows — OAuth
 * token exchanges and MCP HTTP requests — against accidental tight loops and
 * brute-force-style repetition. Because this app has no server of its own, the
 * limiter lives in the client and protects the *downstream* endpoints (and the
 * user's own credentials) from runaway request storms.
 *
 * It also records failures per key so repeated auth failures can be surfaced as
 * suspicious activity.
 */

export interface RateLimitOptions {
  /** Max events allowed within the window. */
  limit: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining allowance in the current window after this check. */
  remaining: number;
  /** Milliseconds until the window frees up (0 when allowed). */
  retryAfterMs: number;
}

const DEFAULTS: Record<string, RateLimitOptions> = {
  // OAuth token endpoints: a healthy flow needs only a handful of calls.
  oauth: { limit: 10, windowMs: 60_000 },
  // MCP HTTP: tool calls can be frequent but a runaway agent loop should trip.
  'mcp-http': { limit: 120, windowMs: 60_000 },
};

// key -> ascending list of event timestamps (ms)
const events = new Map<string, number[]>();
// key -> consecutive failure count (suspicious-activity signal)
const failures = new Map<string, number>();

/** Injectable clock so tests stay deterministic (no Date.now in scripts). */
export const _clock = { now: (): number => Date.now() };

function optionsFor(category: string, override?: Partial<RateLimitOptions>): RateLimitOptions {
  const base = DEFAULTS[category] ?? { limit: 60, windowMs: 60_000 };
  return { ...base, ...override };
}

/**
 * Check (and record) an event against the limiter for `key`.
 * Categories with sensible defaults: 'oauth', 'mcp-http'. Pass `override` to tune.
 */
export function checkRateLimit(
  key: string,
  category = 'mcp-http',
  override?: Partial<RateLimitOptions>,
): RateLimitResult {
  const { limit, windowMs } = optionsFor(category, override);
  const now = _clock.now();
  const cutoff = now - windowMs;

  const recent = (events.get(key) ?? []).filter(t => t > cutoff);

  if (recent.length >= limit) {
    const oldest = recent[0];
    events.set(key, recent);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, oldest + windowMs - now) };
  }

  recent.push(now);
  events.set(key, recent);
  return { allowed: true, remaining: Math.max(0, limit - recent.length), retryAfterMs: 0 };
}

/** Record an authentication/request failure for `key`; returns the new streak. */
export function recordFailure(key: string): number {
  const next = (failures.get(key) ?? 0) + 1;
  failures.set(key, next);
  return next;
}

/** Clear the failure streak for `key` (call on success). */
export function recordSuccess(key: string): void {
  failures.delete(key);
}

/**
 * True when `key` has accumulated enough consecutive failures to look like
 * brute-force / abuse and warrants a warning to the user.
 */
export function isSuspicious(key: string, threshold = 5): boolean {
  return (failures.get(key) ?? 0) >= threshold;
}

/** Current consecutive-failure count for `key`. */
export function failureCount(key: string): number {
  return failures.get(key) ?? 0;
}

/** Test/util helper: wipe all limiter state. */
export function resetRateLimiter(): void {
  events.clear();
  failures.clear();
}
