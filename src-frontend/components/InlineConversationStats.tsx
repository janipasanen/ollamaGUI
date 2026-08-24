import { useRef, useState } from 'react';
import type { ConversationStats } from '../services/conversationStats';

interface Props {
  stats: ConversationStats | null;
  dark: boolean;
}

/**
 * Inline conversation statistics chip (#547).
 * Shows total messages count compactly in the header area.
 */
export function InlineConversationStats({ stats, dark }: Props) {
  const [expanded, setExpanded] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  if (!stats || stats.totalMessages === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        ref={btnRef}
        onClick={() => setExpanded(prev => !prev)}
        title={`Conversation: ${stats.totalMessages} messages`}
        aria-label={`Conversation: ${stats.totalMessages} messages`}
        aria-expanded={expanded}
        data-testid="inline-conversation-stats"
        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
          dark 
            ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200' 
            : 'bg-zinc-200 text-zinc-600 hover:bg-zinc-300 hover:text-zinc-900'
        }`}
      >
        {stats.totalMessages} msg
      </button>
    </div>
  );
}
