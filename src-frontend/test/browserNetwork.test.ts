/**
 * Browser network recorder and the tools built on it (#624, #625, #626).
 *
 * The point of this feature is answering "what did the page actually send and
 * get back" — so the tests assert on the things a user debugging a login would
 * ask: did the POST happen, what status came back, what failed, and did we
 * avoid putting their session cookie into the model's context.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  recordRequest, recordResponse, recordFailure, getNetworkEntries,
  redactHeaders, capBody, statusMatches, summarizeEntry, clearNetwork,
  _resetNetworkForTests, MAX_ENTRIES, MAX_BODY_CHARS,
} from '../services/browserNetwork';
import {
  recordPageError, getPageErrors, clearPageErrors, attachPageErrorListeners, MAX_ERRORS,
} from '../services/browserErrors';
import { instrumentWindow } from '../services/browserInstrument';
import { registerBrowserTools, _mocks as toolMocks, _resetEngineNetworkMerge } from '../services/browser-tools';
import { toolRegistry } from '../services/tools';

beforeEach(() => { _resetNetworkForTests(); clearPageErrors(); });

describe('network recording (#624)', () => {
  it('records a request and completes it with its response', () => {
    const id = recordRequest({ method: 'post', url: 'https://api.example.com/login', startedAt: 1000 });
    recordResponse(id, { status: 200, statusText: 'OK', body: '{"ok":true}', endedAt: 1150 });
    const [e] = getNetworkEntries();
    expect(e.method).toBe('POST');           // normalised
    expect(e.url).toBe('https://api.example.com/login');
    expect(e.status).toBe(200);
    expect(e.durationMs).toBe(150);
    expect(e.responseBody).toBe('{"ok":true}');
  });

  it('records a request that never completed, with its reason', () => {
    const id = recordRequest({ method: 'GET', url: 'https://down.example.com/x', startedAt: 0 });
    recordFailure(id, 'connection refused', 90);
    const [e] = getNetworkEntries();
    expect(e.failed).toBe(true);
    expect(e.failureReason).toBe('connection refused');
    expect(e.status).toBeUndefined();
  });

  it('is bounded and drops the oldest first', () => {
    for (let i = 0; i < MAX_ENTRIES + 25; i++) {
      recordRequest({ method: 'GET', url: `https://x/${i}` });
    }
    const all = getNetworkEntries();
    expect(all).toHaveLength(MAX_ENTRIES);
    // The survivors are the newest ones.
    expect(all[all.length - 1].url).toBe(`https://x/${MAX_ENTRIES + 24}`);
    expect(all[0].url).toBe('https://x/25');
  });

  it('ignores completion for an entry that has been evicted', () => {
    const id = recordRequest({ method: 'GET', url: 'https://x/old' });
    for (let i = 0; i < MAX_ENTRIES + 5; i++) recordRequest({ method: 'GET', url: `https://x/${i}` });
    expect(() => recordResponse(id, { status: 200 })).not.toThrow();
  });
});

describe('redaction happens at record time (#624)', () => {
  it('never stores credential headers', () => {
    // Stored, not just hidden on read: anything in the buffer can reach the
    // model context and from there the provider.
    const id = recordRequest({
      method: 'GET', url: 'https://api/x',
      headers: { Authorization: 'Bearer sk-secret', Cookie: 'session=abc', Accept: 'application/json' },
    });
    recordResponse(id, { status: 200, headers: { 'Set-Cookie': 'session=xyz', 'content-type': 'application/json' } });
    const [e] = getNetworkEntries();
    expect(e.requestHeaders!.Authorization).toBe('<redacted>');
    expect(e.requestHeaders!.Cookie).toBe('<redacted>');
    expect(e.responseHeaders!['Set-Cookie']).toBe('<redacted>');
    // Non-sensitive headers survive: knowing the content type is useful.
    expect(e.requestHeaders!.Accept).toBe('application/json');
    expect(JSON.stringify(e)).not.toContain('sk-secret');
  });

  it('matches header names case-insensitively', () => {
    expect(redactHeaders({ AUTHORIZATION: 'x', 'X-Api-Key': 'y' })).toEqual({
      AUTHORIZATION: '<redacted>', 'X-Api-Key': '<redacted>',
    });
  });

  it('caps a large body and says how much was dropped', () => {
    const capped = capBody('a'.repeat(MAX_BODY_CHARS + 500))!;
    expect(capped.length).toBeLessThan(MAX_BODY_CHARS + 200);
    expect(capped).toContain('truncated 500 chars');
  });
});

describe('filtering (#625)', () => {
  beforeEach(() => {
    const a = recordRequest({ method: 'GET', url: 'https://api/users' });
    recordResponse(a, { status: 200 });
    const b = recordRequest({ method: 'POST', url: 'https://api/login' });
    recordResponse(b, { status: 401 });
    const c = recordRequest({ method: 'GET', url: 'https://cdn/logo.png' });
    recordResponse(c, { status: 503 });
    const d = recordRequest({ method: 'POST', url: 'https://api/timeout' });
    recordFailure(d, 'timeout');
  });

  it('filters by url substring, case-insensitively', () => {
    expect(getNetworkEntries({ filter: 'API/LOG' }).map(e => e.url)).toEqual(['https://api/login']);
  });

  it('filters by method', () => {
    expect(getNetworkEntries({ method: 'post' })).toHaveLength(2);
  });

  it('filters by exact status and by class', () => {
    expect(getNetworkEntries({ status: 401 })).toHaveLength(1);
    expect(getNetworkEntries({ status: '4xx' }).map(e => e.status)).toEqual([401]);
    expect(getNetworkEntries({ status: '5xx' }).map(e => e.status)).toEqual([503]);
  });

  it('filters to failures only', () => {
    const failed = getNetworkEntries({ failedOnly: true });
    expect(failed).toHaveLength(1);
    expect(failed[0].failureReason).toBe('timeout');
  });

  it('limits to the newest N', () => {
    expect(getNetworkEntries({ limit: 2 }).map(e => e.url)).toEqual([
      'https://cdn/logo.png', 'https://api/timeout',
    ]);
  });

  it('a failed request has no status, so status filters skip it', () => {
    expect(statusMatches(undefined, '4xx')).toBe(false);
  });

  it('summarises an entry in one line', () => {
    const e = getNetworkEntries({ filter: 'login' })[0];
    expect(summarizeEntry(e)).toContain('POST https://api/login → 401');
  });
});

describe('page errors (#626)', () => {
  it('records exceptions and rejections separately from console noise', () => {
    recordPageError({ kind: 'exception', message: 'TypeError: x is not a function', stack: 'at foo' });
    recordPageError({ kind: 'rejection', message: 'fetch failed' });
    const errs = getPageErrors();
    expect(errs.map(e => e.kind)).toEqual(['exception', 'rejection']);
    expect(errs[0].stack).toBe('at foo');
  });

  it('is bounded', () => {
    for (let i = 0; i < MAX_ERRORS + 10; i++) recordPageError({ kind: 'exception', message: `e${i}` });
    expect(getPageErrors()).toHaveLength(MAX_ERRORS);
  });

  it('returns the newest N when limited', () => {
    for (let i = 0; i < 5; i++) recordPageError({ kind: 'exception', message: `e${i}` });
    expect(getPageErrors(2).map(e => e.message)).toEqual(['e3', 'e4']);
  });

  it('captures a real error event and ignores resource-load failures', () => {
    const detach = attachPageErrorListeners(window);
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'a.js', lineno: 3 }));
    // A failed <img> fires 'error' with no message; that is a network problem,
    // not a page error, and must not pollute this channel.
    window.dispatchEvent(new ErrorEvent('error', { message: '' }));
    detach();
    const errs = getPageErrors();
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toBe('boom');
    expect(errs[0].line).toBe(3);
  });

  it('stops recording once detached', () => {
    const detach = attachPageErrorListeners(window);
    detach();
    window.dispatchEvent(new ErrorEvent('error', { message: 'after detach' }));
    expect(getPageErrors()).toHaveLength(0);
  });
});

describe('instrumentWindow records real traffic (#624)', () => {
  function fakeWindow(fetchImpl: any): any {
    const listeners: Record<string, Function[]> = {};
    return {
      fetch: fetchImpl,
      XMLHttpRequest: undefined,
      addEventListener: (t: string, fn: Function) => { (listeners[t] ||= []).push(fn); },
      removeEventListener: (t: string, fn: Function) => {
        listeners[t] = (listeners[t] || []).filter(f => f !== fn);
      },
    };
  }

  it('records a fetch and its response without consuming the caller body', async () => {
    const body = JSON.stringify({ token: 'abc' });
    const res = new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    const win = fakeWindow(vi.fn().mockResolvedValue(res));
    instrumentWindow(win);

    const out = await win.fetch('https://api/login', { method: 'POST', body: '{"u":"a"}' });
    // The page must still be able to read its own response.
    await expect(out.text()).resolves.toBe(body);

    const [e] = getNetworkEntries();
    expect(e.method).toBe('POST');
    expect(e.status).toBe(200);
    expect(e.responseBody).toBe(body);
    expect(e.requestBody).toBe('{"u":"a"}');
  });

  it('records a rejected fetch as a failure and still rethrows', async () => {
    const win = fakeWindow(vi.fn().mockRejectedValue(new Error('connection refused')));
    instrumentWindow(win);
    await expect(win.fetch('https://down/x')).rejects.toThrow('connection refused');
    const [e] = getNetworkEntries();
    expect(e.failed).toBe(true);
    expect(e.failureReason).toContain('connection refused');
  });

  it('does not double-patch when called twice', async () => {
    const win = fakeWindow(vi.fn().mockResolvedValue(new Response('x', { status: 200 })));
    instrumentWindow(win);
    instrumentWindow(win);
    await win.fetch('https://api/once');
    expect(getNetworkEntries()).toHaveLength(1);
  });

  it('restores the original fetch on dispose', async () => {
    const original = vi.fn().mockResolvedValue(new Response('x', { status: 200 }));
    const win = fakeWindow(original);
    const dispose = instrumentWindow(win);
    dispose();
    await win.fetch('https://api/after-dispose');
    expect(getNetworkEntries()).toHaveLength(0);
    expect(win.fetch).toBe(original);
  });
});

describe('clearNetwork', () => {
  it('empties the log', () => {
    recordRequest({ method: 'GET', url: 'https://x' });
    clearNetwork();
    expect(getNetworkEntries()).toHaveLength(0);
  });
});

// ── External pages via the Chromium engine (#628) ────────────────────────────

describe('browser_read_network merges the engine log (#628)', () => {
  beforeEach(() => {
    _resetNetworkForTests();
    _resetEngineNetworkMerge();
    toolMocks.invoke = null;
  });
  afterEach(() => { toolMocks.invoke = null; });

  async function readNetwork(args: Record<string, unknown> = {}) {
    registerBrowserTools(async () => true);
    return toolRegistry.getTool('browser_read_network')!.execute(args) as any;
  }

  it('includes requests only the engine saw', async () => {
    // The fetch/XHR patch cannot reach a cross-origin page; without this merge
    // an external login flow reports no traffic at all.
    toolMocks.invoke = async (cmd: string) => {
      if (cmd === 'browser_cdp_read_network') {
        return [
          { request_id: 'r1', method: 'POST', url: 'https://site/login', status: 302, status_text: 'Found' },
          { request_id: 'r2', method: 'GET', url: 'https://site/home', status: 200 },
        ];
      }
      return undefined;
    };
    const out = await readNetwork();
    expect(out.count).toBe(2);
    expect(out.requests.map((r: any) => r.url)).toEqual(['https://site/login', 'https://site/home']);
    expect(out.requests[0].status).toBe(302);
  });

  it('carries an engine failure through as failed', async () => {
    toolMocks.invoke = async (cmd: string) =>
      cmd === 'browser_cdp_read_network'
        ? [{ request_id: 'r3', method: 'GET', url: 'https://site/x', failure: 'net::ERR_CONNECTION_REFUSED' }]
        : undefined;
    const out = await readNetwork({ failed_only: true });
    expect(out.count).toBe(1);
    expect(out.requests[0].status).toBe('failed');
    expect(out.requests[0].failureReason).toContain('ERR_CONNECTION_REFUSED');
  });

  it('does not duplicate engine rows across repeated reads', async () => {
    toolMocks.invoke = async (cmd: string) =>
      cmd === 'browser_cdp_read_network'
        ? [{ request_id: 'r4', method: 'GET', url: 'https://site/once', status: 200 }]
        : undefined;
    await readNetwork();
    const second = await readNetwork();
    expect(second.count).toBe(1);
  });

  it('still reports locally-recorded traffic when no engine is running', async () => {
    // The command throws with no engine; the local recorder is the whole answer.
    toolMocks.invoke = async () => { throw new Error('Engine not started'); };
    const id = recordRequest({ method: 'GET', url: 'http://localhost:5173/api' });
    recordResponse(id, { status: 200 });
    const out = await readNetwork();
    expect(out.count).toBe(1);
    expect(out.requests[0].url).toBe('http://localhost:5173/api');
  });

  it('says so plainly when nothing matched', async () => {
    toolMocks.invoke = async () => [];
    const out = await readNetwork({ filter: 'nothing-matches-this' });
    expect(out.count).toBe(0);
    expect(out.note).toMatch(/No matching network requests/i);
  });
});
