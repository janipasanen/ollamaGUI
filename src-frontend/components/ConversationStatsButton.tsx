import { useEffect, useState } from 'react';
import type { ConversationStats } from '../services/conversationStats';
import { formatTokenCount } from '../services/tokenEstimate';

interface Props {
  stats: ConversationStats | null;
  dark: boolean;
}

/**
 * Toolbar control that reveals per-conversation statistics (#262):
 * message / user / assistant counts, words, characters and an approximate
 * token estimate. Renders nothing when there is no conversation.
 */
export function ConversationStatsButton({ stats, dark }: Props) {
  const [open, setOpen] = useState(false);

  // Escape dismisses the popover (#449), matching the app's other overlays.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!stats || stats.totalMessages === 0) return null;

  const rows: Array<[string, string]> = [
    ['Messages', String(stats.totalMessages)],
    ['User / Assistant', `${stats.userMessages} / ${stats.assistantMessages}`],
    ['Words', stats.words.toLocaleString()],
    ['Characters', stats.characters.toLocaleString()],
    ['Est. tokens', formatTokenCount(stats.tokens)],
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(prev => !prev)}
        title="Conversation statistics"
        aria-label="Conversation statistics"
        aria-expanded={open}
        className={`p-2 rounded-md transition-colors ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
      >
        ℹ
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Conversation statistics"
            className={`absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border p-3 text-xs shadow-lg ${
              dark ? 'bg-zinc-800 border-zinc-700 text-zinc-200' : 'bg-white border-zinc-300 text-zinc-800'
            }`}
          >
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between py-0.5">
                <span className={dark ? 'text-zinc-400' : 'text-zinc-500'}>{label}</span>
                <span className="font-mono">{value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
