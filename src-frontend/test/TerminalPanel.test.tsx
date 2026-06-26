import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';

const { registerSpy, openPanelSpy } = vi.hoisted(() => ({
  registerSpy: vi.fn(),
  openPanelSpy: vi.fn(),
}));

vi.mock('../components/PanelShell', () => ({
  panelRegistry: {
    register: (...args: any[]) => registerSpy(...args),
    unregister: vi.fn(),
    list: vi.fn(() => []),
    get: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
  openPanel: (...args: any[]) => openPanelSpy(...args),
  closePanel: vi.fn(),
  togglePanel: vi.fn(),
  isPanelOpen: vi.fn(),
}));


import TerminalPanel, { registerTerminalPanel } from '../components/TerminalPanel';
import {
  startTerminal,
  clearTerminalSessions,
  _mocks as terminalMocks,
} from '../services/terminal';

type LineHandler = (line: { line: string; stream: 'stdout' | 'stderr'; done: boolean }) => void;

let _handlers = new Map<string, LineHandler>();
let _sessionId = 1;

beforeEach(() => {
  clearTerminalSessions();
  _handlers = new Map();
  _sessionId = 1;

  terminalMocks.invoke = async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'terminal_run') return _sessionId++;
    if (cmd === 'terminal_kill') return undefined;
    throw new Error(`Unexpected: ${cmd}`);
  };
  terminalMocks.listen = async (event: string, handler: LineHandler) => {
    _handlers.set(event, handler);
    return () => { _handlers.delete(event); };
  };
});

afterEach(() => {
  cleanup();
  clearTerminalSessions();
  terminalMocks.invoke = null;
  terminalMocks.listen = null;
});

function emit(id: number, line: string, stream: 'stdout' | 'stderr' = 'stdout') {
  _handlers.get(`terminal_output_${id}`)?.({ line, stream, done: false });
}

function emitDone(id: number) {
  _handlers.get(`terminal_output_${id}`)?.({ line: '', stream: 'stdout', done: true });
}

describe('TerminalPanel (#87, #81)', () => {
  beforeAll(() => {
    registerTerminalPanel();
  });

  it('registers as a bottom-dock panel (id "terminal") at module load', () => {
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0][0]).toMatchObject({
      id: 'terminal',
      title: 'Terminal',
      dock: 'bottom',
    });
  });

  it('renders a placeholder when no sessions exist', () => {
    const registered = registerSpy.mock.calls[0][0];
    render(registered.render(false));
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
    expect(screen.getByText(/No terminal sessions/)).toBeInTheDocument();
  });

  it('displays a running session and its output lines', async () => {
    const id = await startTerminal('echo hello');
    emit(id, 'hello world');
    emit(id, 'line two', 'stderr');

    const registered = registerSpy.mock.calls[0][0];
    render(registered.render(false));

    expect(screen.getByTestId(`terminal-session-${id}`)).toBeInTheDocument();
    expect(screen.getByText('echo hello')).toBeInTheDocument();
    expect(screen.getAllByTestId('terminal-line-stdout').some((el) => el.textContent === 'hello world')).toBe(true);
    expect(screen.getAllByTestId('terminal-line-stderr').some((el) => el.textContent === 'line two')).toBe(true);
  });

  it('kills a running session when Stop is clicked', async () => {
    const id = await startTerminal('sleep 60');
    const registered = registerSpy.mock.calls[0][0];
    render(registered.render(false));

    const stop = screen.getByLabelText('Kill session');
    await act(async () => { fireEvent.click(stop); });

    await waitFor(() => {
      expect(screen.getByTestId(`terminal-session-${id}`).textContent).toContain('killed');
    }, { timeout: 2000 });
  });

  it('clears all sessions when Clear all is clicked', async () => {
    await startTerminal('echo one');
    await startTerminal('echo two');

    const registered = registerSpy.mock.calls[0][0];
    render(registered.render(false));
    expect(screen.getAllByTestId(/terminal-session-/)).toHaveLength(2);

    await act(async () => { fireEvent.click(screen.getByLabelText('Clear terminal sessions')); });
    expect(screen.getByText(/No terminal sessions/)).toBeInTheDocument();
  });
});
