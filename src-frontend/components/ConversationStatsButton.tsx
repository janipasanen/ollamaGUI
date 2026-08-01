import { useRef, useState } from 'react';
import type { ConversationStats } from '../services/conversationStats';
import { formatTokenCount } from '../services/tokenEstimate';
import { AnchoredMenu } from './AnchoredMenu';

interface Props {
  stats: ConversationStats | null;
  dark: boolean;
}

/**
 * Toolbar control that reveals per-conversation statistics (#262):
 * message / user / assistant counts, words, characters and an approximate
 * token estimate. Renders nothing when there is no conversation.
 *
 * The popover goes through AnchoredMenu because the header sets
 * `overflow-x-auto` (#450), which clipped the previously absolutely-positioned
 * panel so its contents were invisible (#487). AnchoredMenu also carries the
 * Escape dismissal this component used to implement itself (#449).
 */
export function ConversationStatsButton({ stats, dark }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  if (!stats || stats.totalMessages === 0) return null;

  const rows: Array<[string, string]> = [
    ['Messages', String(stats.totalMessages)],
    ['User / Assistant', `${stats.userMessages} / ${stats.assistantMessages}`],
    ['Words', stats.words.toLocaleString()],
    ['Characters', stats.characters.toLocaleString()],
    ['Est. tokens', formatTokenCount(stats.tokens)],
  ];

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(prev => !prev)}
        title="Conversation statistics"
        aria-label="Conversation statistics"
        aria-expanded={open}
        data-testid="conversation-stats-button"
        className={`p-2 rounded-md transition-colors ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
      >
        ℹ
      </button>
      <AnchoredMenu
        anchorRef={btnRef}
        open={open}
        onClose={() => setOpen(false)}
        dark={dark}
        align="right"
        role="dialog"
        ariaLabel="Conversation statistics"
        className="w-56 p-3 text-xs"
      >
        <div data-testid="conversation-stats-popover">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between py-0.5">
              <span className={dark ? 'text-zinc-400' : 'text-zinc-500'}>{label}</span>
              <span className="font-mono">{value}</span>
            </div>
          ))}
        </div>
      </AnchoredMenu>
    </>
  );
}
