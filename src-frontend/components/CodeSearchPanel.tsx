/**
 * Code search panel (#431).
 *
 * A workspace-wide grep UI backed by the `search_files` Rust command (#420):
 * text or regex, optional path-glob filter, results grouped by file with line
 * numbers. Clicking a hit dispatches the shared `ollama-gui:select-file` event
 * (same as FileTreePanel), which pins the file into the chat context.
 *
 * Registers itself into the side dock via panelRegistry, mirroring the other
 * workspace panels.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { panelRegistry } from './PanelShell';
import { searchFiles, type SearchHit } from '../services/fileTools';

export interface CodeSearchPanelProps {
  dark: boolean;
}

function openHit(path: string, name: string): void {
  window.dispatchEvent(
    new CustomEvent('ollama-gui:select-file', { detail: { entry: { path, name, is_dir: false } } }),
  );
}

export default function CodeSearchPanel({ dark }: CodeSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [includeGlob, setIncludeGlob] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  const runSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!query.trim()) return;
      setLoading(true);
      setError(null);
      // Clear stale hits so a slow search doesn't display the previous
      // query's results as if they were current (#451).
      setHits([]);
      try {
        const results = await searchFiles(query, {
          isRegex,
          includeGlob: includeGlob.trim() || undefined,
          maxResults: 500,
        });
        setHits(results);
        setRan(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setHits([]);
        setRan(true);
      } finally {
        setLoading(false);
      }
    },
    [query, isRegex, includeGlob],
  );

  // Group hits by file for display.
  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const arr = map.get(h.file) ?? [];
      arr.push(h);
      map.set(h.file, arr);
    }
    return Array.from(map.entries());
  }, [hits]);

  const inputCls = `flex-1 text-sm rounded-md px-2 py-1 border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'
  }`;

  return (
    <div
      data-testid="code-search-panel"
      className={`flex flex-col h-full ${dark ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-700'}`}
    >
      <form onSubmit={runSearch} className={`flex flex-col gap-1 p-2 border-b ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search query"
            placeholder="Search workspace…"
            className={inputCls}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="text-xs px-3 py-1 rounded font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
          >
            {loading ? '…' : 'Search'}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <label className={`flex items-center gap-1 text-[11px] cursor-pointer ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
            <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} aria-label="Use regex" />
            Regex
          </label>
          <input
            type="text"
            value={includeGlob}
            onChange={(e) => setIncludeGlob(e.target.value)}
            aria-label="File glob filter"
            placeholder="glob filter (optional)"
            className={`flex-1 text-[11px] rounded px-2 py-0.5 border font-mono focus:outline-none ${
              dark ? 'bg-zinc-900 border-zinc-700 text-zinc-300' : 'bg-white border-zinc-300 text-zinc-700'
            }`}
          />
        </div>
      </form>

      <div className="flex-1 overflow-y-auto text-xs">
        {error && <p className="px-3 py-2 text-red-400">{error}</p>}
        {loading && (
          <p className={`px-3 py-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Searching…</p>
        )}
        {!error && !loading && ran && hits.length === 0 && (
          <p className={`px-3 py-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>No matches.</p>
        )}
        {!ran && !error && !loading && (
          <p className={`px-3 py-2 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            Search the workspace for text or a regex. Click a result to pin the file into chat.
          </p>
        )}
        {grouped.map(([file, fileHits]) => (
          <div key={file} className="mb-1">
            <div
              className={`px-3 py-1 font-mono font-semibold truncate ${dark ? 'text-zinc-300 bg-zinc-800/60' : 'text-zinc-700 bg-zinc-100'}`}
              title={file}
            >
              {file} <span className="opacity-60">({fileHits.length})</span>
            </div>
            {fileHits.map((h, i) => (
              <button
                key={`${file}:${h.line}:${i}`}
                type="button"
                onClick={() => openHit(file, file.split('/').pop() || file)}
                className={`w-full text-left px-3 py-0.5 flex gap-2 items-baseline ${dark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-50'}`}
              >
                <span className={`shrink-0 tabular-nums ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>{h.line}</span>
                <span className="font-mono truncate">{h.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Register the code-search panel into the side dock (called at startup). */
export function registerCodeSearchPanel(): void {
  (panelRegistry as any)?.register?.({
    id: 'code-search',
    title: 'Search',
    icon: '🔎',
    dock: 'side',
    render: (dark: boolean) => <CodeSearchPanel dark={dark} />,
  });
}
