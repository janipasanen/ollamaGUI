import React from 'react';
import { diffLines, groupHunks, mergeHunks, type PendingEdit, type EditDecision } from '../services/diffReview';

export interface DiffReviewModalProps {
  edit: PendingEdit;
  dark: boolean;
  onResolve: (decision: EditDecision) => void;
}

export const DiffReviewModal: React.FC<DiffReviewModalProps> = ({ edit, dark, onResolve }) => {
  const before = edit.kind === 'apply_edit' ? (edit.oldString ?? '') : '';
  const after = edit.newString;
  const lines = React.useMemo(() => diffLines(before, after), [before, after]);
  const hunks = React.useMemo(() => groupHunks(lines), [lines]);
  const [accepted, setAccepted] = React.useState<boolean[]>(() => hunks.map(() => true));
  const [copiedDiff, setCopiedDiff] = React.useState(false);

  // Keep the accepted array in sync if the edit changes (new proposal).
  React.useEffect(() => { setAccepted(hunks.map(() => true)); }, [hunks.length]);

  const lineToHunk = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const h of hunks) for (const i of h.lineIndices) m.set(i, h.index);
    return m;
  }, [hunks]);

  const resolve = (acc: boolean) => {
    if (acc && edit.kind === 'apply_edit') {
      const merged = mergeHunks(lines, accepted);
      onResolve({ id: edit.id, accepted: true, mergedNewString: merged });
    } else {
      onResolve({ id: edit.id, accepted: acc });
    }
  };

  const toggleHunk = (hunkIdx: number) => {
    setAccepted(prev => prev.map((a, i) => (i === hunkIdx ? !a : a)));
  };

  const allAccepted = accepted.length > 0 && accepted.every(Boolean);

  // Copy a unified-diff string to the clipboard (#370).
  const copyDiff = () => {
    const diffText = edit.kind === 'write_file'
      ? `--- /dev/null\n+++ b/${edit.path}\n${after.split('\n').map(l => `+${l}`).join('\n')}`
      : `--- a/${edit.path}\n+++ b/${edit.path}\n${lines.map(l => `${l.kind === 'added' ? '+' : l.kind === 'removed' ? '-' : ' '}${l.text}`).join('\n')}`;
    navigator.clipboard.writeText(diffText);
    setCopiedDiff(true);
    setTimeout(() => setCopiedDiff(false), 1500);
  };

  // Keyboard shortcuts: Enter = Accept, Escape = Reject (#362).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isButton = active instanceof HTMLButtonElement;
      if (e.key === 'Escape') { e.preventDefault(); resolve(false); }
      else if (e.key === 'Enter' && !isButton) { e.preventDefault(); resolve(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accepted, edit, lines, hunks]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="Review file edit">
      <div className={`w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden ${dark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'}`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${dark ? 'border-zinc-700 bg-zinc-800/60' : 'border-zinc-200 bg-zinc-50'}`}>
          <div>
            <span className={`text-sm font-semibold ${dark ? 'text-zinc-100' : 'text-zinc-800'}`}>Review file edit</span>
            <span className={`ml-2 text-xs font-mono ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>{edit.path}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copyDiff} aria-label="Copy diff to clipboard" title="Copy diff to clipboard" className={`text-xs px-2 py-1 rounded transition-colors ${dark ? 'text-zinc-400 hover:text-blue-400' : 'text-zinc-500 hover:text-blue-600'}`}>{copiedDiff ? '✓ Copied' : '⧉ Copy diff'}</button>
            <button onClick={() => resolve(false)} aria-label="Reject edit" className={`text-xs px-2 py-1 rounded ${dark ? 'text-zinc-400 hover:text-red-400' : 'text-zinc-500 hover:text-red-500'}`}>✕</button>
          </div>
        </div>
        <div className="overflow-auto flex-1 font-mono text-xs p-2">
          {edit.kind === 'write_file' ? (
            <pre className={`whitespace-pre-wrap break-all p-2 rounded ${dark ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-50 text-zinc-800'}`}>{after}</pre>
          ) : (
            (() => {
              let lastHunk = -1;
              return lines.map((dl, i) => {
                const hunkIdx = lineToHunk.get(i);
                const isHunkStart = hunkIdx !== undefined && hunkIdx !== lastHunk;
                if (hunkIdx !== undefined) lastHunk = hunkIdx;
                const hunkAccepted = hunkIdx !== undefined ? accepted[hunkIdx] : true;
                let cls = dark ? 'text-zinc-400' : 'text-zinc-500';
                if (dl.kind === 'added') {
                  cls = hunkAccepted
                    ? (dark ? 'bg-emerald-900/40 text-emerald-300' : 'bg-emerald-50 text-emerald-800')
                    : (dark ? 'text-zinc-600 line-through' : 'text-zinc-400 line-through');
                } else if (dl.kind === 'removed') {
                  cls = hunkAccepted
                    ? (dark ? 'bg-red-900/40 text-red-300 line-through' : 'bg-red-50 text-red-700 line-through')
                    : (dark ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-700');
                }
                return (
                  <React.Fragment key={i}>
                    {isHunkStart && (
                      <div className={`flex items-center gap-2 my-1 px-2 py-1 rounded ${dark ? 'bg-zinc-800/60' : 'bg-zinc-100'}`}>
                        <button
                          onClick={() => toggleHunk(hunkIdx!)}
                          aria-label={hunkAccepted ? `Reject hunk ${hunkIdx! + 1}` : `Accept hunk ${hunkIdx! + 1}`}
                          aria-pressed={hunkAccepted}
                          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${hunkAccepted ? (dark ? 'border-emerald-600 text-emerald-400' : 'border-emerald-500 text-emerald-700') : (dark ? 'border-zinc-600 text-zinc-400' : 'border-zinc-300 text-zinc-500')}`}
                        >
                          {hunkAccepted ? '✓' : '✗'} Hunk {hunkIdx! + 1}
                        </button>
                        <span className={dark ? 'text-zinc-500' : 'text-zinc-400'}>{hunkAccepted ? 'will apply' : 'will keep original'}</span>
                      </div>
                    )}
                    <div className={`px-2 py-0.5 ${cls}`}>
                      <span className="select-none mr-2 opacity-40">{dl.kind === 'added' ? '+' : dl.kind === 'removed' ? '-' : ' '}</span>
                      {dl.text}
                    </div>
                  </React.Fragment>
                );
              });
            })()
          )}
        </div>
        <div className={`flex items-center justify-between gap-2 px-4 py-3 border-t shrink-0 ${dark ? 'border-zinc-700 bg-zinc-800/60' : 'border-zinc-200 bg-zinc-50'}`}>
          {hunks.length > 0 && edit.kind === 'apply_edit' ? (
            <button
              onClick={() => setAccepted(prev => prev.map(() => !allAccepted))}
              className={`text-xs underline ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}
            >
              {allAccepted ? 'Reject all hunks' : 'Accept all hunks'}
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={() => resolve(false)} className={`px-4 py-2 rounded-lg text-sm font-medium border ${dark ? 'border-zinc-600 text-zinc-300 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'}`}>Reject</button>
            <button onClick={() => resolve(true)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white">Accept</button>
          </div>
        </div>
      </div>
    </div>
  );
};
