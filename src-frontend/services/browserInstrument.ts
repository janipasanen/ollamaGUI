/**
 * Attach recording to a page window (#624, #626).
 *
 * Patches `fetch` and `XMLHttpRequest` so requests the page makes land in the
 * network log, and installs the error listeners. Only usable on a same-origin
 * document — a cross-origin iframe denies `contentWindow` access, which is why
 * the caller wraps this in a try/catch and the Chromium engine path (which has
 * CDP and no such limit) is the answer for external sites.
 */
import { recordRequest, recordResponse, recordFailure } from './browserNetwork';
import { attachPageErrorListeners } from './browserErrors';

/** Marker so a re-render or reload does not stack duplicate patches. */
const MARK = '__ollamaGuiInstrumented__';

function headersToObject(h: HeadersInit | undefined): Record<string, string> | undefined {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  try {
    if (h instanceof Headers) h.forEach((v, k) => { out[k] = v; });
    else if (Array.isArray(h)) for (const [k, v] of h) out[String(k)] = String(v);
    else for (const [k, v] of Object.entries(h)) out[k] = String(v);
  } catch { return undefined; }
  return out;
}

/**
 * Instrument `win`. Returns a disposer; safe to call twice (the second call is
 * a no-op and returns the existing disposer's behaviour).
 */
export function instrumentWindow(win: Window): () => void {
  const w = win as any;
  if (w[MARK]) return w[MARK].dispose ?? (() => {});

  const detachErrors = attachPageErrorListeners(win);
  // Keep the ORIGINAL reference for restoration and a bound copy for calling:
  // restoring the bound copy would leave the page with a function that is not
  // the one it started with, which breaks identity checks and monkey-patch
  // chains other code may rely on.
  const origFetchRaw = w.fetch;
  const origFetch = typeof origFetchRaw === 'function' ? origFetchRaw.bind(w) : undefined;
  const OrigXHR = w.XMLHttpRequest;

  if (typeof origFetch === 'function') {
    w.fetch = async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input?.url ?? String(input));
      const method = (init?.method ?? input?.method ?? 'GET').toUpperCase();
      const id = recordRequest({
        method, url, resourceType: 'fetch',
        headers: headersToObject(init?.headers),
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      try {
        const res = await origFetch(input, init);
        // Read the body from a CLONE: consuming the caller's response would
        // break the page, which is the one thing instrumentation must never do.
        let body: string | undefined;
        try {
          const ct = res.headers.get('content-type') ?? '';
          if (/json|text|xml|javascript|urlencoded/i.test(ct)) body = await res.clone().text();
        } catch { /* body not readable (opaque/stream) — status alone is useful */ }
        const headers: Record<string, string> = {};
        try { res.headers.forEach((v: string, k: string) => { headers[k] = v; }); } catch { /* opaque */ }
        recordResponse(id, { status: res.status, statusText: res.statusText, headers, body });
        return res;
      } catch (err: any) {
        recordFailure(id, String(err?.message ?? err));
        throw err;
      }
    };
  }

  if (typeof OrigXHR === 'function') {
    w.XMLHttpRequest = function PatchedXHR(this: any) {
      const xhr = new OrigXHR();
      let id = -1;
      let method = 'GET';
      let url = '';
      const origOpen = xhr.open.bind(xhr);
      const origSend = xhr.send.bind(xhr);
      xhr.open = (m: string, u: string, ...rest: any[]) => {
        method = String(m || 'GET').toUpperCase();
        url = String(u);
        return origOpen(m, u, ...rest);
      };
      xhr.send = (body?: any) => {
        id = recordRequest({
          method, url, resourceType: 'xhr',
          body: typeof body === 'string' ? body : undefined,
        });
        xhr.addEventListener('load', () => {
          let text: string | undefined;
          try { text = typeof xhr.responseText === 'string' ? xhr.responseText : undefined; } catch { /* non-text */ }
          recordResponse(id, { status: xhr.status, statusText: xhr.statusText, body: text });
        });
        xhr.addEventListener('error', () => recordFailure(id, 'network error'));
        xhr.addEventListener('abort', () => recordFailure(id, 'aborted'));
        xhr.addEventListener('timeout', () => recordFailure(id, 'timeout'));
        return origSend(body);
      };
      return xhr;
    } as any;
  }

  const dispose = () => {
    detachErrors();
    if (origFetchRaw) w.fetch = origFetchRaw;
    if (OrigXHR) w.XMLHttpRequest = OrigXHR;
    delete w[MARK];
  };
  w[MARK] = { dispose };
  return dispose;
}
