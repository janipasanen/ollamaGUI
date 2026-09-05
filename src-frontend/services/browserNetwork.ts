/**
 * Browser network recorder (#624).
 *
 * The browser could report console output but had no network visibility at
 * all, which is most of the value of driving a page: "why did the login fail"
 * and "what did the API actually return" are network questions, not console
 * ones. This module records requests and responses so both the Browser panel
 * and the agent (`browser_read_network`, #625) can read them back.
 *
 * Two design points worth keeping:
 *
 *  - The buffer is BOUNDED. A single page load can issue hundreds of requests
 *    and bodies are large; an unbounded log would grow until the tab died.
 *    Oldest entries are dropped first.
 *
 *  - Sensitive headers are redacted at RECORD time, not at read time. Anything
 *    in here can reach the model context and from there the provider, so the
 *    value must never be stored in the first place — a redaction applied only
 *    on the way out would still leak through a panel, a screenshot or a future
 *    reader that forgot to call it.
 */

/** Header names whose values must never be stored. Compared case-insensitively. */
export const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'api-key',
];

/** Largest number of entries kept; oldest are dropped first. */
export const MAX_ENTRIES = 200;

/** Longest body retained per entry, in characters. */
export const MAX_BODY_CHARS = 8_000;

export interface NetworkEntry {
  id: number;
  method: string;
  url: string;
  /** Set once the response arrives; absent while in flight or on failure. */
  status?: number;
  statusText?: string;
  /** 'fetch' | 'xhr' | 'document' | 'script' | … — best-effort. */
  resourceType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  /** Epoch ms when the request went out. */
  startedAt: number;
  /** Wall time from request to response/failure. */
  durationMs?: number;
  failed?: boolean;
  failureReason?: string;
}

export interface NetworkFilter {
  /** Case-insensitive substring match on the URL. */
  filter?: string;
  method?: string;
  /** An exact code (404) or a class ('4xx', '5xx'). */
  status?: string | number;
  failedOnly?: boolean;
  /** Newest N entries. */
  limit?: number;
}

let entries: NetworkEntry[] = [];
let nextId = 1;

/** Replace sensitive values with a marker, preserving which headers were sent. */
export function redactHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.includes(k.toLowerCase()) ? '<redacted>' : v;
  }
  return out;
}

/** Cap a body and say so, rather than truncating silently. */
export function capBody(body?: string): string | undefined {
  if (body == null) return undefined;
  if (body.length <= MAX_BODY_CHARS) return body;
  return `${body.slice(0, MAX_BODY_CHARS)}\n… [truncated ${body.length - MAX_BODY_CHARS} chars]`;
}

/** Record an outgoing request; returns the id used to complete it. */
export function recordRequest(init: {
  method: string;
  url: string;
  resourceType?: string;
  headers?: Record<string, string>;
  body?: string;
  startedAt?: number;
}): number {
  const entry: NetworkEntry = {
    id: nextId++,
    method: (init.method || 'GET').toUpperCase(),
    url: init.url,
    resourceType: init.resourceType,
    requestHeaders: redactHeaders(init.headers),
    requestBody: capBody(init.body),
    startedAt: init.startedAt ?? Date.now(),
  };
  entries.push(entry);
  // Bounded: drop oldest first.
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
  return entry.id;
}

/** Complete a request with its response. Unknown ids are ignored (evicted). */
export function recordResponse(id: number, res: {
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  endedAt?: number;
}): void {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  e.status = res.status;
  e.statusText = res.statusText;
  e.responseHeaders = redactHeaders(res.headers);
  e.responseBody = capBody(res.body);
  e.durationMs = Math.max(0, (res.endedAt ?? Date.now()) - e.startedAt);
}

/** Complete a request that never produced a response. */
export function recordFailure(id: number, reason: string, endedAt?: number): void {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  e.failed = true;
  e.failureReason = reason;
  e.durationMs = Math.max(0, (endedAt ?? Date.now()) - e.startedAt);
}

/** True when `status` satisfies a filter that may be a code or a class. */
export function statusMatches(status: number | undefined, want: string | number): boolean {
  if (status == null) return false;
  const w = String(want).toLowerCase();
  const m = /^([1-5])xx$/.exec(w);
  if (m) return Math.floor(status / 100) === Number(m[1]);
  return status === Number(w);
}

/** Read recorded traffic, newest last, after applying `f`. */
export function getNetworkEntries(f: NetworkFilter = {}): NetworkEntry[] {
  let out = entries;
  if (f.filter) {
    const needle = f.filter.toLowerCase();
    out = out.filter(e => e.url.toLowerCase().includes(needle));
  }
  if (f.method) {
    const m = f.method.toUpperCase();
    out = out.filter(e => e.method === m);
  }
  if (f.status != null) out = out.filter(e => statusMatches(e.status, f.status!));
  if (f.failedOnly) out = out.filter(e => e.failed === true);
  if (f.limit != null && f.limit > 0 && out.length > f.limit) out = out.slice(out.length - f.limit);
  return out;
}

/** Everything recorded, oldest first. Mainly for the panel. */
export function allNetworkEntries(): NetworkEntry[] {
  return entries.slice();
}

export function clearNetwork(): void {
  entries = [];
}

/** Test seam: reset ids too, so assertions can depend on them. */
export function _resetNetworkForTests(): void {
  entries = [];
  nextId = 1;
}

/** One-line summary of an entry, for tool output and the panel list. */
export function summarizeEntry(e: NetworkEntry): string {
  const status = e.failed ? `FAILED (${e.failureReason ?? 'unknown'})` : (e.status ?? 'pending');
  const ms = e.durationMs != null ? ` ${e.durationMs}ms` : '';
  return `${e.method} ${e.url} → ${status}${ms}`;
}
