import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startTerminal, killTerminal, subscribe, getSession, getSessions,
  clearTerminalSessions, _mocks,
  type TerminalLine,
} from '../services/terminal';

type EventHandler = (line: TerminalLine) => void;

let _handlers: Map<string, EventHandler> = new Map();
let _sessionIdCounter = 100;

function makeMocks() {
  _handlers = new Map();
  _mocks.invoke = async (cmd, args) => {
    if (cmd === 'terminal_run') {
      const id = _sessionIdCounter++;
      return id;
    }
    if (cmd === 'terminal_kill') return undefined;
    throw new Error(`Unexpected: ${cmd}`);
  };
  _mocks.listen = async (event, handler) => {
    _handlers.set(event, handler);
    return () => _handlers.delete(event);
  };
}

/** Simulate the Rust backend emitting a line event. */
function emit(sessionId: number, line: string, stream: 'stdout' | 'stderr' = 'stdout') {
  const handler = _handlers.get(`terminal_output_${sessionId}`);
  handler?.({ line, stream, done: false });
}

/** Simulate the Rust backend signaling the process finished. */
function emitDone(sessionId: number) {
  const handler = _handlers.get(`terminal_output_${sessionId}`);
  handler?.({ line: '', stream: 'stdout', done: true });
}

beforeEach(() => {
  clearTerminalSessions();
  _sessionIdCounter = 100;
  makeMocks();
});

afterEach(() => {
  clearTerminalSessions();
  _mocks.invoke = null;
  _mocks.listen = null;
});

describe('startTerminal (#87)', () => {
  it('returns a session id and creates a session', async () => {
    const id = await startTerminal('ls -la');
    expect(id).toBe(100);
    expect(getSession(100)).toBeDefined();
    expect(getSession(100)?.command).toBe('ls -la');
    expect(getSession(100)?.status).toBe('running');
  });

  it('accumulates lines from events', async () => {
    const id = await startTerminal('echo hello');
    emit(id, 'line 1');
    emit(id, 'line 2');
    const session = getSession(id)!;
    expect(session.lines).toHaveLength(2);
    expect(session.lines[0].line).toBe('line 1');
  });

  it('marks session as done when done event fires', async () => {
    const id = await startTerminal('exit 0');
    emitDone(id);
    expect(getSession(id)?.status).toBe('done');
  });

  it('includes session in getSessions', async () => {
    await startTerminal('cmd1');
    await startTerminal('cmd2');
    expect(getSessions()).toHaveLength(2);
  });
});

describe('subscribe (#87)', () => {
  it('calls handler for each new line', async () => {
    const id = await startTerminal('ls');
    const received: string[] = [];
    subscribe(id, l => { if (!l.done) received.push(l.line); });
    emit(id, 'file1.txt');
    emit(id, 'file2.txt');
    expect(received).toEqual(['file1.txt', 'file2.txt']);
  });

  it('replays already-received lines to new subscriber', async () => {
    const id = await startTerminal('ls');
    emit(id, 'early-line');
    const received: string[] = [];
    subscribe(id, l => { if (!l.done) received.push(l.line); });
    expect(received).toContain('early-line');
  });

  it('unsubscribe stops further callbacks', async () => {
    const id = await startTerminal('ls');
    const received: string[] = [];
    const unsub = subscribe(id, l => { if (!l.done) received.push(l.line); });
    emit(id, 'before');
    unsub();
    emit(id, 'after');
    expect(received).toContain('before');
    expect(received).not.toContain('after');
  });
});

describe('killTerminal (#87)', () => {
  it('marks the session as killed', async () => {
    const id = await startTerminal('sleep 60');
    await killTerminal(id);
    expect(getSession(id)?.status).toBe('killed');
  });

  it('calls terminal_kill with the session id', async () => {
    let killedId: number | null = null;
    _mocks.invoke = async (cmd, args) => {
      if (cmd === 'terminal_run') return 200;
      if (cmd === 'terminal_kill') { killedId = (args as any).session_id; return undefined; }
      return undefined;
    };
    const id = await startTerminal('sleep 60');
    await killTerminal(id);
    expect(killedId).toBe(200);
  });

  it('is a no-op for an unknown session id', async () => {
    await expect(killTerminal(9999)).resolves.not.toThrow();
  });
});

describe('clearTerminalSessions (#87)', () => {
  it('removes all sessions', async () => {
    await startTerminal('cmd1');
    await startTerminal('cmd2');
    clearTerminalSessions();
    expect(getSessions()).toHaveLength(0);
  });
});
