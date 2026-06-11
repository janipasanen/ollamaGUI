/**
 * Tiered document conversion service (#140).
 *
 * Frontend wrapper around the Rust `convert_document_tiered`, `convert_cancel`
 * and `check_libreoffice_available` commands. The Rust side routes a conversion
 * through the cheapest viable engine (bundled crate → Pandoc → optional
 * LibreOffice) and streams progress via Tauri events.
 *
 * This service:
 *   - invokes `convert_document_tiered` with a per-call `jobId`,
 *   - subscribes to the `convert://progress` event (best-effort; guarded so a
 *     missing event runtime never breaks the conversion),
 *   - wires an optional `AbortSignal` to `convert_cancel`,
 *   - exposes `checkLibreOffice` for the optional-engine availability check.
 *
 * Test seam: set `_mocks.invoke` and `_mocks.listen` before each test.
 */

export type Unsubscribe = () => void;

/** Progress payload emitted by the Rust side on `convert://progress`. */
export interface ConvertProgress {
  job_id: string;
  /** 0.0 .. 1.0 */
  ratio: number;
}

/** Result of a tiered conversion. */
export interface ConvertResult {
  /** Which engine ran: 'bundled' | 'pandoc' | 'libreoffice'. */
  engine: string;
  ok: boolean;
}

/** LibreOffice availability probe result. */
export interface LibreOfficeAvailability {
  available: boolean;
  path?: string;
  version?: string;
}

/** Test seam. */
export const _mocks = {
  invoke: null as ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null,
  listen: null as
    | ((event: string, handler: (payload: ConvertProgress) => void) => Promise<Unsubscribe>)
    | null,
};

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (_mocks.invoke) return _mocks.invoke(cmd, args) as Promise<T>;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/**
 * Subscribe to a Tauri event. Returns an unsubscribe fn. Guarded: if the event
 * runtime is unavailable (e.g. running outside Tauri, or import fails), this
 * resolves to a no-op unsubscribe so conversion still proceeds.
 */
async function tauriListen(
  event: string,
  handler: (payload: ConvertProgress) => void,
): Promise<Unsubscribe> {
  if (_mocks.listen) return _mocks.listen(event, handler);
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<ConvertProgress>(event, e => handler(e.payload));
    return unlisten;
  } catch {
    return () => {};
  }
}

let _jobCounter = 0;

/** Generate a unique-ish job id for a conversion call. */
function nextJobId(): string {
  _jobCounter += 1;
  return `convert-${Date.now()}-${_jobCounter}`;
}

/**
 * Convert `from` → `to` using the tiered engine. The target format is inferred
 * from `to`'s extension if `targetFormat` is omitted.
 *
 * `opts.onProgress` receives 0..1 ratios as the Rust side emits them.
 * `opts.signal`, when aborted, fires `convert_cancel` for this job's id.
 */
export async function convertDocument(
  from: string,
  to: string,
  targetFormat?: string,
  opts?: { onProgress?: (ratio: number) => void; signal?: AbortSignal },
): Promise<ConvertResult> {
  const jobId = nextJobId();
  const format = targetFormat ?? extOf(to);

  // Subscribe to progress before invoking so early events aren't missed.
  let unlisten: Unsubscribe = () => {};
  if (opts?.onProgress) {
    unlisten = await tauriListen('convert://progress', payload => {
      // Only react to this job's progress when an id is present.
      if (!payload.job_id || payload.job_id === jobId) {
        opts.onProgress?.(payload.ratio);
      }
    });
  }

  // Wire cancellation: an aborted signal cancels the tracked child.
  const onAbort = () => {
    void tauriInvoke<void>('convert_cancel', { jobId }).catch(() => {});
  };
  if (opts?.signal) {
    if (opts.signal.aborted) {
      // Already aborted before we started — cancel immediately.
      onAbort();
    } else {
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  try {
    return await tauriInvoke<ConvertResult>('convert_document_tiered', {
      fromPath: from,
      toPath: to,
      targetFormat: format,
      jobId,
    });
  } finally {
    unlisten();
    opts?.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Cancel a running conversion by its job id. Normally invoked indirectly via an
 * `AbortSignal` passed to `convertDocument`, but exposed for direct use too.
 */
export async function cancelConversion(jobId: string): Promise<void> {
  await tauriInvoke<void>('convert_cancel', { jobId });
}

/** Probe whether the optional LibreOffice engine is installed. */
export async function checkLibreOffice(): Promise<LibreOfficeAvailability> {
  return tauriInvoke<LibreOfficeAvailability>('check_libreoffice_available', {});
}

/** Lower-cased extension of a path without the dot (e.g. 'report.PDF' → 'pdf'). */
function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : '';
}
