/**
 * Terminal streaming service (#87).
 *
 * Wraps the Rust `terminal_run` / `terminal_kill` commands and the Tauri event
 * system so the terminal panel can subscribe to a live stream of stdout/stderr
 * lines without polling. Each session has a unique numeric id.
 *
 * Test seam: set `_mocks.invoke` and `_mocks.listen` before each test.
 */

export interface TerminalLine {
  line: string;
  stream: 'stdout' | 'stderr';
  done: boolean;
}

export interface TerminalSession {
  id: number;
  command: string;
  lines: TerminalLine[];
  status: 'running' | 'done' | 'killed';
}

export type LineHandler = (line: TerminalLine) => void;
export type Unsubscribe = () => void;

/** Test seam. */
export const _mocks = {
  invoke: null as ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null,
  listen: null as ((event: string, handler: (payload: TerminalLine) => void) => Promise<Unsubscribe>) | null,
};

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (_mocks.invoke) return _mocks.invoke(cmd, args) as Promise<T>;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function tauriListen(
  event: string,
  handler: (payload: TerminalLine) => void,
): Promise<Unsubscribe> {
  if (_mocks.listen) return _mocks.listen(event, handler);
  const { listen } = await import('@tauri-apps/api/event');
  const unlistenFn = await listen<TerminalLine>(event, e => handler(e.payload));
  return unlistenFn;
}

// ── Session registry ──────────────────────────────────────────────────────────

const _sessions = new Map<number, TerminalSession>();
const _subscribers = new Map<number, Set<LineHandler>>();
const _unlisteners = new Map<number, Unsubscribe>();

export function getSessions(): TerminalSession[] {
  return Array.from(_sessions.values());
}

export function getSession(id: number): TerminalSession | undefined {
  return _sessions.get(id);
}

export function subscribe(id: number, handler: LineHandler): Unsubscribe {
  if (!_subscribers.has(id)) _subscribers.set(id, new Set());
  _subscribers.get(id)!.add(handler);
  // Replay existing lines immediately
  const session = _sessions.get(id);
  if (session) session.lines.forEach(handler);
  return () => _subscribers.get(id)?.delete(handler);
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Start a new terminal session.
 * @returns The numeric session id used to subscribe / kill.
 */
export async function startTerminal(command: string, cwd?: string): Promise<number> {
  const id = await tauriInvoke<number>('terminal_run', { command, cwd: cwd ?? null });
  const session: TerminalSession = { id, command, lines: [], status: 'running' };
  _sessions.set(id, session);
  _subscribers.set(id, new Set());

  const eventName = `terminal_output_${id}`;
  const unlisten = await tauriListen(eventName, (payload: TerminalLine) => {
    if (payload.done) {
      session.status = 'done';
      _unlisteners.get(id)?.();
      _unlisteners.delete(id);
    } else {
      session.lines.push(payload);
    }
    _subscribers.get(id)?.forEach(h => h(payload));
  });
  _unlisteners.set(id, unlisten);
  return id;
}

/** Kill a running terminal session. */
export async function killTerminal(id: number): Promise<void> {
  const session = _sessions.get(id);
  if (!session) return;
  session.status = 'killed';
  _unlisteners.get(id)?.();
  _unlisteners.delete(id);
  await tauriInvoke<void>('terminal_kill', { session_id: id });
}

/** Clear all sessions (for tests / session reset). */
export function clearTerminalSessions(): void {
  _sessions.clear();
  _subscribers.clear();
  _unlisteners.forEach(u => u());
  _unlisteners.clear();
}
