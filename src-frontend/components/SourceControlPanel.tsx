/**
 * Source-control panel (#434).
 *
 * Surfaces the workspace git working tree: staged / changed / untracked files
 * (git_status), a per-file diff viewer (git_diff), and stage / unstage actions
 * (git_stage / git_unstage). Backed by the same Rust git commands the agent
 * uses, so the user gets a read/act view of what the agent (or they) changed.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { panelRegistry } from './PanelShell';
import { getWorkspaceRoot } from '../services/fileTools';
import { gitStatus, gitDiff, gitStage, gitUnstage, type GitStatus } from '../services/git';

export interface SourceControlPanelProps {
  dark: boolean;
}

type Section = 'staged' | 'unstaged' | 'untracked';

export default function SourceControlPanel({ dark }: SourceControlPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<{ file: string; staged: boolean } | null>(null);
  const [diff, setDiff] = useState<string>('');

  const root = getWorkspaceRoot();

  const refresh = useCallback(async () => {
    if (!root) { setStatus(null); setError('No workspace open.'); return; }
    setLoading(true);
    try {
      const s = await gitStatus(root);
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [root]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openDiff = useCallback(async (file: string, staged: boolean) => {
    if (!root) return;
    setSelected({ file, staged });
    try {
      const d = await gitDiff(root, file, staged);
      setDiff(d.diff || '(no diff)');
    } catch (e) {
      setDiff(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [root]);

  const doStage = useCallback(async (file: string) => {
    if (!root) return;
    await gitStage(root, [file]).catch(() => {});
    await refresh();
  }, [root, refresh]);

  const doUnstage = useCallback(async (file: string) => {
    if (!root) return;
    await gitUnstage(root, [file]).catch(() => {});
    await refresh();
  }, [root, refresh]);

  const rowCls = `group/scrow w-full flex items-center gap-1 px-2 py-0.5 text-xs ${dark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`;
  const muted = dark ? 'text-zinc-500' : 'text-zinc-400';

  const renderSection = (label: string, files: string[], section: Section) => {
    if (files.length === 0) return null;
    return (
      <div className="mb-1" data-testid={`scm-section-${section}`}>
        <div className={`px-2 py-1 text-[10px] uppercase tracking-wide font-semibold ${muted}`}>{label} ({files.length})</div>
        {files.map((f) => (
          <div key={`${section}:${f}`} className={rowCls}>
            <button
              type="button"
              onClick={() => openDiff(f, section === 'staged')}
              className={`flex-1 text-left truncate font-mono ${selected?.file === f ? (dark ? 'text-blue-300' : 'text-blue-600') : (dark ? 'text-zinc-300' : 'text-zinc-700')}`}
              title={f}
            >
              {f}
            </button>
            {section === 'staged' ? (
              <button type="button" onClick={() => doUnstage(f)} aria-label={`Unstage ${f}`} title="Unstage"
                className={`shrink-0 opacity-0 group-hover/scrow:opacity-100 px-1 ${muted} hover:text-red-400`}>−</button>
            ) : (
              <button type="button" onClick={() => doStage(f)} aria-label={`Stage ${f}`} title="Stage"
                className={`shrink-0 opacity-0 group-hover/scrow:opacity-100 px-1 ${muted} hover:text-green-400`}>+</button>
            )}
          </div>
        ))}
      </div>
    );
  };

  const empty = status && status.staged.length === 0 && status.unstaged.length === 0 && status.untracked.length === 0;

  return (
    <div data-testid="source-control-panel" className={`flex flex-col h-full ${dark ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-700'}`}>
      <div className={`flex items-center justify-between px-2 h-8 shrink-0 border-b ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
        <span className="text-xs font-semibold">Source Control</span>
        <button type="button" onClick={() => void refresh()} aria-label="Refresh source control" title="Refresh"
          className={`text-sm px-1 rounded ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}>⟳</button>
      </div>

      <div className={`overflow-y-auto text-xs ${diff ? 'max-h-[45%]' : 'flex-1'}`}>
        {error && <p className="px-2 py-2 text-red-400">{error}</p>}
        {loading && !status && <p className={`px-2 py-2 ${muted}`}>Loading…</p>}
        {empty && <p className={`px-2 py-2 ${muted}`}>Working tree clean.</p>}
        {status && !empty && (
          <>
            {renderSection('Staged', status.staged, 'staged')}
            {renderSection('Changes', status.unstaged, 'unstaged')}
            {renderSection('Untracked', status.untracked, 'untracked')}
          </>
        )}
      </div>

      {diff && (
        <div className={`flex-1 min-h-0 overflow-auto border-t ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
          <div className={`px-2 py-1 text-[10px] font-mono truncate ${muted}`}>{selected?.file}</div>
          <pre className="text-[11px] font-mono px-2 pb-2 whitespace-pre">
            {diff.split('\n').map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith('+') && !line.startsWith('+++') ? 'text-green-400'
                    : line.startsWith('-') && !line.startsWith('---') ? 'text-red-400'
                    : line.startsWith('@@') ? (dark ? 'text-blue-300' : 'text-blue-600')
                    : ''
                }
              >
                {line || ' '}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Register the source-control panel into the side dock (called at startup). */
export function registerSourceControlPanel(): void {
  (panelRegistry as any)?.register?.({
    id: 'source-control',
    title: 'Git',
    icon: '⑂',
    dock: 'side',
    render: (dark: boolean) => <SourceControlPanel dark={dark} />,
  });
}
