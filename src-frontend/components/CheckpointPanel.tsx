/**
 * Checkpoint browser (#435).
 *
 * The agent can snapshot files via create_checkpoint and restore via
 * rewind_checkpoint (#91), but there was no UI to browse or roll back those
 * snapshots, and deleteCheckpoint/clearCheckpoints were unwired. This panel
 * lists checkpoints (label, time, file count) with Rewind and Delete actions,
 * plus a Clear-all, so the user can undo agent edits from the UI.
 */

import React, { useCallback, useState } from 'react';
import { panelRegistry } from './PanelShell';
import { listCheckpoints, deleteCheckpoint, clearCheckpoints, rewindToCheckpoint, type Checkpoint } from '../services/checkpoints';

export interface CheckpointPanelProps {
  dark: boolean;
}

export default function CheckpointPanel({ dark }: CheckpointPanelProps) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(() => listCheckpoints());
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => setCheckpoints(listCheckpoints()), []);

  const rewind = useCallback(async (cp: Checkpoint) => {
    setBusy(cp.id);
    try {
      const restored = await rewindToCheckpoint(cp.id);
      setStatus(`Rewound ${restored.length} file${restored.length !== 1 ? 's' : ''} to "${cp.label}".`);
    } catch (e) {
      setStatus(`Rewind failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const remove = useCallback((id: string) => { deleteCheckpoint(id); refresh(); }, [refresh]);
  const clearAll = useCallback(() => {
    if (window.confirm('Delete all checkpoints?')) { clearCheckpoints(); refresh(); setStatus('All checkpoints cleared.'); }
  }, [refresh]);

  const muted = dark ? 'text-zinc-500' : 'text-zinc-400';

  return (
    <div data-testid="checkpoint-panel" className={`flex flex-col h-full ${dark ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-700'}`}>
      <div className={`flex items-center justify-between px-2 h-8 shrink-0 border-b ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
        <span className="text-xs font-semibold">Checkpoints ({checkpoints.length})</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={refresh} aria-label="Refresh checkpoints" title="Refresh"
            className={`text-sm px-1 rounded ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}>⟳</button>
          {checkpoints.length > 0 && (
            <button type="button" onClick={clearAll} aria-label="Clear all checkpoints" title="Clear all"
              className={`text-[10px] px-1.5 py-0.5 rounded border ${dark ? 'border-zinc-700 text-red-400 hover:bg-zinc-800' : 'border-zinc-300 text-red-500 hover:bg-zinc-100'}`}>Clear</button>
          )}
        </div>
      </div>

      {status && <p className={`px-2 py-1 text-[11px] ${dark ? 'text-blue-300' : 'text-blue-600'}`}>{status}</p>}

      <div className="flex-1 overflow-y-auto">
        {checkpoints.length === 0 && (
          <p className={`px-2 py-2 text-xs ${muted}`}>No checkpoints yet. The agent creates them before risky edits (create_checkpoint).</p>
        )}
        {checkpoints.map((cp) => (
          <div key={cp.id} className={`group/cp flex items-center gap-2 px-2 py-1.5 text-xs border-b ${dark ? 'border-zinc-800 hover:bg-zinc-800/60' : 'border-zinc-100 hover:bg-zinc-50'}`}>
            <div className="flex-1 min-w-0">
              <div className={`font-medium truncate ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>{cp.label}</div>
              <div className={`text-[10px] ${muted}`}>
                {new Date(cp.createdAt).toLocaleString()} · {Object.keys(cp.files).length} file{Object.keys(cp.files).length !== 1 ? 's' : ''}
              </div>
            </div>
            <button type="button" disabled={busy === cp.id} onClick={() => void rewind(cp)} aria-label={`Rewind to ${cp.label}`} title="Restore files to this checkpoint"
              className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${dark ? 'border-zinc-600 text-zinc-300 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'} ${busy === cp.id ? 'opacity-50' : ''}`}>
              {busy === cp.id ? '…' : '↩ Rewind'}
            </button>
            <button type="button" onClick={() => remove(cp.id)} aria-label={`Delete checkpoint ${cp.label}`} title="Delete checkpoint"
              className={`shrink-0 text-[10px] px-1 rounded ${muted} hover:text-red-400`}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Register the checkpoint panel into the side dock (called at startup). */
export function registerCheckpointPanel(): void {
  (panelRegistry as any)?.register?.({
    id: 'checkpoints',
    title: 'Checkpoints',
    icon: '🕰',
    dock: 'side',
    render: (dark: boolean) => <CheckpointPanel dark={dark} />,
  });
}
