/**
 * Agent activity / tool-timeline panel (#432).
 *
 * Shows a live, chronological timeline of the agent's tool calls and results for
 * the current run — tool name, args/result preview, and time — so autonomous
 * runs are followable and debuggable. Driven by the agentActivity store, which
 * App.tsx feeds from the agenticChatStream tool callbacks.
 */

import React, { useEffect, useState } from 'react';
import { panelRegistry } from './PanelShell';
import { listActivity, subscribeActivity, clearActivity, type AgentActivityEvent } from '../services/agentActivity';

export interface AgentActivityPanelProps {
  dark: boolean;
}

function timeOf(ts: number): string {
  try { return new Date(ts).toLocaleTimeString(); } catch { return ''; }
}

export default function AgentActivityPanel({ dark }: AgentActivityPanelProps) {
  const [events, setEvents] = useState<AgentActivityEvent[]>(() => listActivity());

  useEffect(() => subscribeActivity(() => setEvents(listActivity())), []);

  const muted = dark ? 'text-zinc-500' : 'text-zinc-400';

  return (
    <div data-testid="agent-activity-panel" className={`flex flex-col h-full ${dark ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-700'}`}>
      <div className={`flex items-center justify-between px-2 h-8 shrink-0 border-b ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
        <span className="text-xs font-semibold">Agent Activity ({events.length})</span>
        {events.length > 0 && (
          <button type="button" onClick={() => clearActivity()} aria-label="Clear agent activity" title="Clear"
            className={`text-[10px] px-1.5 py-0.5 rounded border ${dark ? 'border-zinc-700 text-zinc-400 hover:bg-zinc-800' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100'}`}>Clear</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto text-xs">
        {events.length === 0 && (
          <p className={`px-2 py-2 ${muted}`}>No agent activity yet. Tool calls appear here during an agentic run.</p>
        )}
        {events.map((e) => (
          <div key={e.id} className={`flex items-start gap-2 px-2 py-1 border-b ${dark ? 'border-zinc-800' : 'border-zinc-100'}`}>
            <span
              className={`shrink-0 mt-0.5 text-[10px] font-semibold ${
                e.kind === 'call' ? (dark ? 'text-blue-300' : 'text-blue-600') : (dark ? 'text-green-400' : 'text-green-600')
              }`}
              title={e.kind === 'call' ? 'tool call' : 'tool result'}
            >
              {e.kind === 'call' ? '▶' : '✓'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-medium truncate">{e.tool}</span>
                <span className={`shrink-0 text-[9px] tabular-nums ${muted}`}>{timeOf(e.ts)}</span>
              </div>
              {e.detail && (
                <div className={`font-mono truncate ${muted}`} title={e.detail}>{e.detail}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Register the agent-activity panel into the side dock (called at startup). */
export function registerAgentActivityPanel(): void {
  (panelRegistry as any)?.register?.({
    id: 'agent-activity',
    title: 'Activity',
    icon: '📡',
    dock: 'side',
    render: (dark: boolean) => <AgentActivityPanel dark={dark} />,
  });
}
