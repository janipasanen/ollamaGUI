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

/**
 * Register the `run_terminal` agent tool (#87/#186).
 * Runs a shell command and streams its output, returning the full combined
 * stdout/stderr once done. Optional `wait_ms` caps the maximum wait time.
 */
export function registerTerminalTool(): void {
  // Lazy-import to avoid circular dependency at module load time.
  import('./tools').then(({ toolRegistry }) => {
    if (toolRegistry.getTool('run_terminal')) return;
    toolRegistry.registerTool({
      name: 'run_terminal',
      description: 'Run a shell command and return its output. Streams stdout/stderr and waits for the process to finish (up to wait_ms, default 30 s).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute.' },
          cwd: { type: 'string', description: 'Working directory. Defaults to the workspace root.' },
          wait_ms: { type: 'number', description: 'Maximum wait time in ms (default 30000).' },
        },
        required: ['command'],
      },
      execute: async (args: unknown) => {
        const { command, cwd, wait_ms = 30_000 } = args as { command: string; cwd?: string; wait_ms?: number };
        const id = await startTerminal(command, cwd);
        const lines: string[] = [];
        const deadline = Date.now() + wait_ms;

        await new Promise<void>((resolve) => {
          const unsub = subscribe(id, (line) => {
            if (line.done) { unsub(); resolve(); return; }
            lines.push(`[${line.stream}] ${line.line}`);
          });
          // Timeout fallback
          const timer = setTimeout(() => { unsub(); resolve(); }, Math.max(0, deadline - Date.now()));
          // Cancel timer if session ends naturally
          const check = setInterval(() => {
            const s = getSession(id);
            if (s && s.status !== 'running') { clearInterval(check); clearTimeout(timer); resolve(); }
          }, 200);
        });

        const output = lines.join('\n');
        const session = getSession(id);
        return output || `(no output — session status: ${session?.status ?? 'unknown'})`;
      },
    });
  });
}
