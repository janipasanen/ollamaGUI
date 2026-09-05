/**
 * Page error channel (#626).
 *
 * Uncaught exceptions and unhandled rejections are the single most useful
 * signal when a page misbehaves, but they were only visible if the page
 * happened to log them — and then only buried among ordinary console output.
 * This keeps them on their own channel so `browser_read_errors` can answer
 * "what broke" without the model reading a hundred log lines first.
 */

export type PageErrorKind = 'exception' | 'rejection';

export interface PageError {
  kind: PageErrorKind;
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  at: number;
}

/** Bounded: a page in a crash loop must not exhaust memory. */
export const MAX_ERRORS = 100;

let errors: PageError[] = [];

export function recordPageError(e: Omit<PageError, 'at'> & { at?: number }): void {
  errors.push({ ...e, at: e.at ?? Date.now() });
  if (errors.length > MAX_ERRORS) errors = errors.slice(errors.length - MAX_ERRORS);
}

/** Newest `limit` errors, oldest first within the slice. */
export function getPageErrors(limit?: number): PageError[] {
  if (limit != null && limit > 0 && errors.length > limit) {
    return errors.slice(errors.length - limit);
  }
  return errors.slice();
}

export function clearPageErrors(): void {
  errors = [];
}

/**
 * Install listeners on a window (the app's own, or an iframe's contentWindow).
 * Returns a disposer so a remounted pane does not stack duplicate listeners.
 */
export function attachPageErrorListeners(win: Window): () => void {
  const onError = (ev: ErrorEvent) => {
    // Resource-load failures surface here too with no message; they are not
    // page errors and belong to the network log instead.
    if (!ev.message) return;
    recordPageError({
      kind: 'exception',
      message: ev.message,
      stack: ev.error?.stack,
      source: ev.filename,
      line: ev.lineno,
      column: ev.colno,
    });
  };
  const onRejection = (ev: PromiseRejectionEvent) => {
    const r: any = ev.reason;
    recordPageError({
      kind: 'rejection',
      message: String(r?.message ?? r ?? 'Unhandled promise rejection'),
      stack: r?.stack,
    });
  };
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection as EventListener);
  return () => {
    win.removeEventListener('error', onError);
    win.removeEventListener('unhandledrejection', onRejection as EventListener);
  };
}
