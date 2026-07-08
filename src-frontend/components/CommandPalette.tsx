import React from 'react';

export interface PaletteCommand {
  id: string;
  label: string;
  /** Optional shortcut hint shown on the right. */
  hint?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  commands: PaletteCommand[];
  onClose: () => void;
  dark: boolean;
}

/** Filter commands by a case-insensitive substring match on the label. */
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter(c => c.label.toLowerCase().includes(q));
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ commands, onClose, dark }) => {
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = filterCommands(commands, query);
  const safeSelected = filtered.length > 0 ? Math.min(selected, filtered.length - 1) : 0;

  const runCommand = (cmd: PaletteCommand) => {
    cmd.run();
    onClose();
  };

  return (
    <div
      className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center pt-[12vh] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div
        className={`border w-full max-w-md rounded-xl shadow-2xl overflow-hidden ${dark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-300'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          aria-label="Command palette search"
          placeholder="Type a command…"
          onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); const cmd = filtered[safeSelected]; if (cmd) runCommand(cmd); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
          className={`w-full px-4 py-3 text-sm bg-transparent outline-none border-b ${dark ? 'text-zinc-100 border-zinc-700 placeholder-zinc-500' : 'text-zinc-800 border-zinc-200 placeholder-zinc-400'}`}
        />
        <div className="max-h-72 overflow-auto py-1">
          {filtered.length === 0 && (
            <div className={`px-4 py-6 text-sm text-center ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No matching commands</div>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              onMouseEnter={() => setSelected(i)}
              onClick={() => runCommand(cmd)}
              aria-label={cmd.label}
              className={`w-full flex items-center justify-between px-4 py-2 text-sm text-left transition-colors ${
                i === safeSelected ? (dark ? 'bg-blue-600/30 text-zinc-100' : 'bg-blue-50 text-zinc-900') : (dark ? 'text-zinc-300' : 'text-zinc-700')
              }`}
            >
              <span>{cmd.label}</span>
              {cmd.hint && <kbd className={`text-[10px] font-mono ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{cmd.hint}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
