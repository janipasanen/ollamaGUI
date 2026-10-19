import { shouldIgnoreEnterShortcut } from './keyboardScope';
import React from 'react';
import { diffLines, type PendingEdit, type EditDecision } from '../services/diffReview';

export interface DiffReviewBatchModalProps {
  edits: PendingEdit[];
  dark: boolean;
  onResolve: (decisions: EditDecision[]) => void;
}

/**
 * Multi-file diff review (#400, Codex GUI / Cursor parity).
 *
 * Presents every file change from a single `apply_patch` in one overlay with
 * per-file Accept/Reject, Accept All / Reject All, and keyboard shortcuts
 * (Enter = apply per-file decisions, Escape = reject all).
 */
export const DiffReviewBatchModal: React.FC<DiffReviewBatchModalProps> = ({ edits, dark, onResolve }) => {
  const [accepted, setAccepted] = React.useState<boolean[]>(() => edits.map(() => true));
  const [activeIdx, setActiveIdx] = React.useState(0);
  React.useEffect(() => { setAccepted(edits.map(() => true)); setActiveIdx(0); }, [edits]);

  const active = edits[activeIdx];
  const before = active?.kind === 'apply_edit' ? (active.oldString ?? '') : '';
  const after = active?.newString ?? '';
  const lines = React.useMemo(() => diffLines(before, after), [before, after]);

  const allAccepted = accepted.length > 0 && accepted.every(Boolean);

  const apply = () => onResolve(edits.map((e, i) => ({ id: e.id, accepted: accepted[i] })));
  const rejectAll = () => onResolve(edits.map(e => ({ id: e.id, accepted: false })));
  const acceptAll = () => setAccepted(edits.map(() => true));
  const rejectAllToggle = () => setAccepted(edits.map(() => false));

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); rejectAll(); }
      // Same guard as the single-file modal (#498). This path was missed: the
      // batch modal has NO focus management, so the chat composer keeps focus
      // while it is open — pressing Enter to send a message applied every
      // pending edit to disk unreviewed.
      else if (e.key === 'Enter' && !shouldIgnoreEnterShortcut(document.activeElement)) {
        e.preventDefault();
        apply();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accepted, edits]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label={`Review ${edits.length} file edits`}>
      <div className={`w-full max-w-3xl max-h-[80vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden ${dark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'}`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${dark ? 'border-zinc-700 bg-zinc-800/60' : 'border-zinc-200 bg-zinc-50'}`}>
          <span className={`text-sm font-semibold ${dark ? 'text-zinc-100' : 'text-zinc-800'}`}>Review {edits.length} file edits</span>
          <button onClick={rejectAll} aria-label="Reject all edits" className={`text-xs px-2 py-1 rounded ${dark ? 'text-zinc-400 hover:text-red-400' : 'text-zinc-500 hover:text-red-500'}`}>✕</button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* File list */}
          <div className={`w-48 shrink-0 overflow-y-auto border-r ${dark ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-200 bg-zinc-50'}`}>
            {/* The accept/reject toggle used to be a <span role="switch"> nested
                INSIDE the row button (#499): invalid nesting, not focusable, and
                unreachable by keyboard — so a keyboard user could not choose
                which files to accept. They are siblings now. */}
            {edits.map((e, i) => (
              <div
                key={e.id}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-mono ${i === activeIdx ? (dark ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-200 text-zinc-900') : (dark ? 'text-zinc-400 hover:bg-zinc-800/60' : 'text-zinc-600 hover:bg-zinc-100')}`}
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={accepted[i]}
                  aria-label={`${accepted[i] ? 'accept' : 'reject'} ${e.path}`}
                  onClick={() => setAccepted(prev => prev.map((a, k) => (k === i ? !a : a)))}
                  className={`shrink-0 w-3 h-3 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 ${accepted[i] ? 'bg-emerald-500' : 'bg-zinc-500'}`}
                />
                <button
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  aria-current={i === activeIdx}
                  className="flex-1 min-w-0 text-left truncate focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                >{e.path}</button>
              </div>
            ))}
          </div>

          {/* Active file diff */}
          <div className="flex-1 overflow-auto font-mono text-xs p-2">
            {active?.kind === 'write_file' ? (
              <pre className={`whitespace-pre-wrap break-all p-2 rounded ${dark ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-50 text-zinc-800'}`}>{after}</pre>
            ) : (
              lines.map((dl, i) => {
                let cls = dark ? 'text-zinc-400' : 'text-zinc-500';
                if (dl.kind === 'added') cls = dark ? 'bg-emerald-900/40 text-emerald-300' : 'bg-emerald-50 text-emerald-800';
                else if (dl.kind === 'removed') cls = dark ? 'bg-red-900/40 text-red-300' : 'bg-red-50 text-red-700';
                return (
                  <div key={i} className={`px-2 py-0.5 ${cls}`}>
                    <span className="select-none mr-2 opacity-40">{dl.kind === 'added' ? '+' : dl.kind === 'removed' ? '-' : ' '}</span>
                    {dl.text}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className={`flex items-center justify-between gap-2 px-4 py-3 border-t shrink-0 ${dark ? 'border-zinc-700 bg-zinc-800/60' : 'border-zinc-200 bg-zinc-50'}`}>
          <button onClick={() => (allAccepted ? rejectAllToggle() : acceptAll())} className={`text-xs underline ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
            {allAccepted ? 'Reject all files' : 'Accept all files'}
          </button>
          <div className="flex gap-2">
            <button onClick={rejectAll} className={`px-4 py-2 rounded-lg text-sm font-medium border ${dark ? 'border-zinc-600 text-zinc-300 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'}`}>Reject</button>
            <button onClick={apply} className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white">Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
};
