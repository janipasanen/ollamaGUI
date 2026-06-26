/**
 * TerminalPanel (#87, #81).
 *
 * A bottom-dock panel that shows live terminal sessions started by the
 * `run_terminal` agent tool. Each session renders as a scrollable stream of
 * stdout/stderr lines with a kill button and a clear-all control.
 *
 * The panel registers itself with panelRegistry (id 'terminal') at module
 * load so the shell can render it as a bottom-dock surface without App.tsx
 * needing to mount it directly.
 */

import React, { useEffect, useRef, useState } from 'react';
import { panelRegistry } from './PanelShell';
import {
  getSessions,
  subscribe,
  killTerminal,
  clearTerminalSessions,
  type TerminalSession,
  type TerminalLine,
} from '../services/terminal';

export interface TerminalPanelProps {
  dark: boolean;
}

/** Status badge color for a session. */
function statusClass(status: TerminalSession['status'], dark: boolean): string {
  if (status === 'running') return dark ? 'text-emerald-400' : 'text-emerald-600';
  if (status === 'killed') return dark ? 'text-red-400' : 'text-red-600';
  return dark ? 'text-zinc-400' : 'text-zinc-500';
}

function TerminalSessionView({ session, dark }: { session: TerminalSession; dark: boolean }): React.ReactElement {
  const [lines, setLines] = useState<TerminalLine[]>(session.lines);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLines(session.lines);
    const unsub = subscribe(session.id, (line) => {
      setLines(prev => [...prev, line]);
    });
    return unsub;
  }, [session.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [lines.length]);

  return (
    <div data-testid={`terminal-session-${session.id}`} className={`flex flex-col h-full ${dark ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-700'}`}>
      <div className={`flex items-center justify-between px-3 py-1.5 border-b text-xs ${dark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`font-mono truncate`}>{session.command}</span>
          <span className={`text-[10px] uppercase font-semibold ${statusClass(session.status, dark)}`}>{session.status}</span>
        </div>
        {session.status === 'running' && (
          <button
            onClick={() => { void killTerminal(session.id); }}
            aria-label="Kill session"
            className={`text-xs px-2 py-0.5 rounded transition-colors ${dark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
          >
            Stop
          </button>
        )}
      </div>
      <div data-testid="terminal-lines" className="flex-1 overflow-auto p-2 font-mono text-xs leading-relaxed">
        {lines.length === 0 && (
          <div className={`italic ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Waiting for output…</div>
        )}
        {lines.map((line, i) => (
          <div
            key={i}
            data-testid={`terminal-line-${line.stream}`}
            className={`whitespace-pre-wrap break-all ${line.stream === 'stderr' ? (dark ? 'text-red-300' : 'text-red-600') : ''}`}
          >
            {line.line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function TerminalPanel({ dark }: TerminalPanelProps): React.ReactElement {
  const [sessions, setSessions] = useState<TerminalSession[]>(() => getSessions());

  useEffect(() => {
    const refresh = () => setSessions(getSessions());
    const interval = setInterval(refresh, 250);
    window.addEventListener('ollama-gui:terminal-update', refresh);
    return () => { clearInterval(interval); window.removeEventListener('ollama-gui:terminal-update', refresh); };
  }, []);


  return (
    <div data-testid="terminal-panel" className={`flex flex-col h-full ${dark ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-700'}`}>
      <div className={`flex items-center justify-between px-3 py-1.5 border-b text-xs ${dark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'}`}>
        <span className="font-medium">Terminal sessions</span>
        {sessions.length > 0 && (
          <button
            onClick={() => { clearTerminalSessions(); setSessions([]); }}
            aria-label="Clear terminal sessions"
            className={`text-xs px-2 py-0.5 rounded transition-colors ${dark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
          >
            Clear all
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {sessions.length === 0 ? (
          <div className={`h-full flex items-center justify-center text-sm ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
            No terminal sessions. Run a command with the&nbsp;<code className="font-mono text-xs">run_terminal</code>&nbsp;tool.
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {sessions.map((session) => (
              <div key={session.id} className="shrink-0 border-b last:border-b-0 h-1/3 min-h-[80px]">
                <TerminalSessionView session={session} dark={dark} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Exported so tests can register after mocking PanelShell. */
export function registerTerminalPanel(): void {
  (panelRegistry as any)?.register?.({
    id: 'terminal',
    title: 'Terminal',
    icon: '▶',
    dock: 'bottom',
    render: (dark: boolean) => <TerminalPanel dark={dark} />,
  });
}

export default TerminalPanel;
