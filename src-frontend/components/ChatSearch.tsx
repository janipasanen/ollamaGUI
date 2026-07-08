import React from 'react';

export interface ChatSearchMessage {
  role: string;
  content: string;
  reasoning?: string;
}

/**
 * Return the indices of messages whose content or reasoning contains the
 * (case-insensitive) query. Empty/whitespace queries match nothing.
 */
export function findMessageMatches(messages: ChatSearchMessage[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: number[] = [];
  messages.forEach((m, i) => {
    const hay = `${m.content ?? ''}\n${m.reasoning ?? ''}`.toLowerCase();
    if (hay.includes(q)) out.push(i);
  });
  return out;
}

export interface ChatSearchProps {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  currentIndex: number; // 0-based within matches, -1 if none
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  dark: boolean;
}

export const ChatSearch: React.FC<ChatSearchProps> = ({
  query, onQueryChange, matchCount, currentIndex, onPrev, onNext, onClose, dark,
}) => {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  const label = matchCount > 0 ? `${currentIndex + 1} / ${matchCount}` : query.trim() ? '0 / 0' : '';
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border shadow-lg ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'}`}
      role="search"
      aria-label="Search in conversation"
    >
      <span aria-hidden="true" className={dark ? 'text-zinc-400' : 'text-zinc-500'}>🔍</span>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? onPrev() : onNext(); }
          else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        placeholder="Find in chat…"
        aria-label="Search query"
        className={`flex-1 bg-transparent text-sm outline-none ${dark ? 'text-zinc-100 placeholder-zinc-500' : 'text-zinc-800 placeholder-zinc-400'}`}
      />
      <span className={`text-xs tabular-nums ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>{label}</span>
      <button onClick={onPrev} aria-label="Previous match" disabled={matchCount === 0} className={`px-1.5 rounded text-sm disabled:opacity-40 ${dark ? 'text-zinc-300 hover:bg-zinc-700' : 'text-zinc-600 hover:bg-zinc-100'}`}>↑</button>
      <button onClick={onNext} aria-label="Next match" disabled={matchCount === 0} className={`px-1.5 rounded text-sm disabled:opacity-40 ${dark ? 'text-zinc-300 hover:bg-zinc-700' : 'text-zinc-600 hover:bg-zinc-100'}`}>↓</button>
      <button onClick={onClose} aria-label="Close search" className={`px-1.5 rounded text-sm ${dark ? 'text-zinc-300 hover:bg-zinc-700' : 'text-zinc-600 hover:bg-zinc-100'}`}>✕</button>
    </div>
  );
};
