/**
 * Language-server diagnostics after edits (#670).
 *
 * One server per project root, started lazily on the first edit. Diagnostics are
 * advisory: a missing binary, a crash, or a slow server must never fail the edit
 * that triggered them, so every path here degrades to "no diagnostics".
 *
 * Only `textDocument/didOpen` + `publishDiagnostics` are implemented — enough to
 * report real errors without taking on the rest of the protocol surface.
 */

export interface Diagnostic {
  range: { start: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
}

export type DiagnosticsOutcome =
  | { status: 'ok'; diagnostics: Diagnostic[] }
  | { status: 'unavailable'; reason: string }
  | { status: 'none' };

export interface ServerSpec {
  command: string;
  args: string[];
  languageId: string;
}

const SERVERS: Record<string, ServerSpec> = {
  ts: { command: 'typescript-language-server', args: ['--stdio'], languageId: 'typescript' },
  tsx: { command: 'typescript-language-server', args: ['--stdio'], languageId: 'typescriptreact' },
  js: { command: 'typescript-language-server', args: ['--stdio'], languageId: 'javascript' },
  jsx: { command: 'typescript-language-server', args: ['--stdio'], languageId: 'javascriptreact' },
  rs: { command: 'rust-analyzer', args: [], languageId: 'rust' },
  py: { command: 'pyright-langserver', args: ['--stdio'], languageId: 'python' },
  go: { command: 'gopls', args: [], languageId: 'go' },
};

/** The server for a path, or null for a language we have no client for. */
export function serverForPath(path: string): ServerSpec | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return SERVERS[ext] ?? null;
}

/** Initialize timeout: rust-analyzer indexes the whole crate before replying. */
export const LSP_INIT_TIMEOUT_MS = 8_000;
/** Diagnostics timeout: an edit must not hang on an indexing server. */
export const LSP_DIAGNOSTICS_TIMEOUT_MS = 2_500;

export function uriFor(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  const prefixed = normalised.startsWith('/') ? normalised : `/${normalised}`;
  return `file://${prefixed.split('/').map(encodeURIComponent).join('/')}`;
}

/** Test seam: replace the Tauri transport without a webview. */
export const _mocks = {
  start: null as ((spec: ServerSpec, cwd: string) => Promise<number>) | null,
  send: null as ((id: number, message: unknown) => Promise<void>) | null,
  stop: null as ((id: number) => Promise<void>) | null,
  listen: null as ((id: number, handler: (body: string) => void) => Promise<() => void>) | null,
};

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function startServer(spec: ServerSpec, cwd: string): Promise<number> {
  if (_mocks.start) return _mocks.start(spec, cwd);
  return tauriInvoke<number>('lsp_start', { command: spec.command, args: spec.args, cwd });
}

async function sendMessage(id: number, message: unknown): Promise<void> {
  const body = JSON.stringify(message);
  if (_mocks.send) return _mocks.send(id, message);
  return tauriInvoke<void>('lsp_send', { sessionId: id, message: body });
}

async function stopServer(id: number): Promise<void> {
  if (_mocks.stop) return _mocks.stop(id);
  return tauriInvoke<void>('lsp_stop', { sessionId: id });
}

async function listenServer(id: number, handler: (body: string) => void): Promise<() => void> {
  if (_mocks.listen) return _mocks.listen(id, handler);
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<string>(`lsp_message_${id}`, e => handler(e.payload));
  return unlisten;
}

interface Session {
  id: number;
  spec: ServerSpec;
  ready: Promise<boolean>;
  unlisten: () => void;
  /** Latest published diagnostics per URI. */
  published: Map<string, Diagnostic[]>;
  waiters: Map<string, (d: Diagnostic[]) => void>;
  nextRequestId: number;
  initializeId: number;
}

const sessions = new Map<string, Session>();
/** Opens in flight, so two simultaneous edits do not spawn two servers. */
const opening = new Map<string, Promise<Session>>();
/** Sticky per-root failures: one broken install must not be retried on every edit. */
const unavailable = new Map<string, string>();

function rootKey(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '');
}

async function openSession(cwd: string, spec: ServerSpec): Promise<Session> {
  const key = rootKey(cwd);
  const existing = sessions.get(key);
  if (existing && existing.spec.command === spec.command) return existing;
  const pending = opening.get(key);
  if (pending) return pending;

  const creating = createSession(key, cwd, spec);
  opening.set(key, creating);
  try {
    return await creating;
  } finally {
    opening.delete(key);
  }
}

async function createSession(key: string, cwd: string, spec: ServerSpec): Promise<Session> {
  const session: Session = {
    id: -1,
    spec,
    ready: Promise.resolve(false),
    unlisten: () => {},
    published: new Map(),
    waiters: new Map(),
    nextRequestId: 2,
    initializeId: 1,
  };

  try {
    session.id = await startServer(spec, cwd);
    session.unlisten = await listenServer(session.id, body => {
      let msg: { method?: string; params?: { uri?: string; diagnostics?: Diagnostic[] } };
      try { msg = JSON.parse(body); } catch { return; }
      if (msg.method !== 'textDocument/publishDiagnostics' || !msg.params?.uri) return;
      const uri = msg.params.uri;
      const diagnostics = msg.params.diagnostics ?? [];
      session.published.set(uri, diagnostics);
      const waiter = session.waiters.get(uri);
      if (waiter) { session.waiters.delete(uri); waiter(diagnostics); }
    });

    session.ready = (async () => {
      await sendMessage(session.id, {
        jsonrpc: '2.0', id: session.initializeId, method: 'initialize',
        params: {
          processId: null,
          rootUri: uriFor(cwd),
          capabilities: { textDocument: { publishDiagnostics: { relatedInformation: false } } },
        },
      });
      await sendMessage(session.id, { jsonrpc: '2.0', method: 'initialized', params: {} });
      return true;
    })();

    sessions.set(key, session);
    return session;
  } catch (e) {
    unavailable.set(key, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Stop every language server (workspace closed, app quitting). */
export async function shutdownLsp(): Promise<void> {
  const all = [...sessions.values()];
  sessions.clear();
  opening.clear();
  for (const s of all) {
    try { s.unlisten(); } catch { /* ignore */ }
    try { if (s.id >= 0) await stopServer(s.id); } catch { /* ignore */ }
  }
}

/** Forget every session. Tests only — does not talk to the transport. */
export function _resetLsp(): void {
  for (const s of sessions.values()) { try { s.unlisten(); } catch { /* ignore */ } }
  sessions.clear();
  opening.clear();
  unavailable.clear();
}

function waitForDiagnostics(session: Session, uri: string, timeoutMs: number): Promise<Diagnostic[] | null> {
  const cached = session.published.get(uri);
  if (cached) return Promise.resolve(cached);
  return new Promise(resolve => {
    const timer = setTimeout(() => { session.waiters.delete(uri); resolve(null); }, timeoutMs);
    session.waiters.set(uri, diagnostics => { clearTimeout(timer); resolve(diagnostics); });
  });
}

/**
 * Ask the language server for the diagnostics of `path`.
 *
 * `cwd` is the project root (the workspace). Returns `none` when there is no
 * server for the extension, or a request is already in flight for this file.
 */
export async function collectDiagnostics(
  path: string,
  cwd: string,
  options: { text?: string; timeoutMs?: number } = {},
): Promise<DiagnosticsOutcome> {
  const spec = serverForPath(path);
  if (!spec) return { status: 'none' };

  const key = rootKey(cwd);
  const sticky = unavailable.get(key);
  if (sticky) return { status: 'unavailable', reason: sticky };

  let session: Session;
  try {
    session = await openSession(cwd, spec);
    await session.ready;
  } catch (e) {
    return { status: 'unavailable', reason: e instanceof Error ? e.message : String(e) };
  }

  const uri = uriFor(path);
  const text = options.text ?? '';
  session.published.delete(uri);
  await sendMessage(session.id, {
    jsonrpc: '2.0', method: 'textDocument/didOpen',
    params: { textDocument: { uri, languageId: spec.languageId, version: 1, text } },
  });

  const diagnostics = await waitForDiagnostics(session, uri, options.timeoutMs ?? LSP_DIAGNOSTICS_TIMEOUT_MS);
  if (!diagnostics) return { status: 'none' };
  return { status: 'ok', diagnostics };
}

const SEVERITY: Record<number, string> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };

/** Render diagnostics as the lines appended to an edit result (max 10). */
export function formatDiagnostics(path: string, diagnostics: Diagnostic[], limit = 10): string {
  const sorted = [...diagnostics].sort((a, b) =>
    a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
  const shown = sorted.slice(0, limit).map(d => {
    const where = `${path}:${d.range.start.line + 1}:${d.range.start.character + 1}`;
    const kind = SEVERITY[d.severity ?? 1] ?? 'error';
    return `- ${where} ${kind}: ${d.message}${d.source ? ` (${d.source})` : ''}`;
  });
  const more = sorted.length > limit ? `\n… ${sorted.length - limit} more` : '';
  return `Diagnostics after the edit:\n${shown.join('\n')}${more}`;
}
