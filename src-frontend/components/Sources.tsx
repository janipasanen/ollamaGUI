/**
 * Sources UI for inline citations (#120).
 *
 * Two exports:
 *  - <Sources>            — a collapsible "Sources (N)" disclosure listing each
 *                           grounding source as a clickable button.
 *  - renderWithCitations  — turns `[n]` markers in answer text into clickable
 *                           <sup>[n]</sup> elements, used by the message renderer.
 *
 * Theming follows the codebase convention: a `dark` boolean drives
 * `dark ? '…' : '…'` class ternaries (no CSS variables).
 */

import React from 'react';
import {
  Source,
  hasSources,
  linkifyCitations,
  openSource,
} from '../services/citations';

// ── Source list disclosure ────────────────────────────────────────────────────

/** A short, human-readable secondary line for a source (url or title). */
function sourceDetail(s: Source): string | undefined {
  if (s.kind === 'url') return s.title ? `${s.title} — ${s.url ?? ''}`.trim() : s.url;
  // file / chunk
  if (s.title) return s.title;
  if (typeof s.chunkIndex === 'number') return `chunk ${s.chunkIndex + 1}`;
  return undefined;
}

interface SourcesProps {
  sources: Source[];
  dark: boolean;
}

/**
 * Collapsible list of the sources a reply is grounded in. Renders nothing when
 * there are no sources. Each entry is a button labelled `[n] label` that opens
 * the underlying file/link on click.
 */
export default function Sources({ sources, dark }: SourcesProps): React.ReactElement | null {
  if (!hasSources(sources)) return null;

  return (
    <details
      className={`mt-2 rounded-lg border text-xs ${
        dark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-300 bg-zinc-100'
      }`}
    >
      <summary
        className={`cursor-pointer select-none px-2 py-1 font-semibold ${
          dark ? 'text-zinc-300' : 'text-zinc-700'
        }`}
      >
        Sources ({sources.length})
      </summary>
      <ul className="px-2 pb-2 space-y-1">
        {sources.map((s, idx) => {
          const detail = sourceDetail(s);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => { void openSource(s); }}
                title={detail ?? s.label}
                className={`w-full text-left rounded px-1.5 py-1 transition-colors ${
                  dark
                    ? 'hover:bg-zinc-700 text-zinc-200'
                    : 'hover:bg-zinc-200 text-zinc-800'
                }`}
              >
                <span className={`font-mono mr-1 ${dark ? 'text-blue-300' : 'text-blue-600'}`}>
                  [{idx + 1}]
                </span>
                <span className="font-medium">{s.label}</span>
                {detail && (
                  <span className={`block truncate ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    {detail}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

// ── Inline citation markers ───────────────────────────────────────────────────

interface InlineCitationProps {
  index: number;
  source: Source;
  dark: boolean;
}

/** A single clickable `[n]` superscript that opens its source. */
export function InlineCitation({ index, source, dark }: InlineCitationProps): React.ReactElement {
  const detail = sourceDetail(source);
  return (
    <sup>
      <button
        type="button"
        onClick={() => { void openSource(source); }}
        aria-label={`Citation ${index}: ${source.label}`}
        title={detail ? `${source.label} — ${detail}` : source.label}
        className={`mx-0.5 align-super text-[10px] font-mono rounded px-0.5 transition-colors ${
          dark
            ? 'text-blue-300 hover:bg-blue-900/40'
            : 'text-blue-600 hover:bg-blue-100'
        }`}
      >
        [{index}]
      </button>
    </sup>
  );
}

/**
 * Render answer `text` with `[n]` markers replaced by clickable citation
 * superscripts. Out-of-range markers are kept as literal text. Returns an array
 * of React nodes suitable for embedding directly in JSX.
 *
 * Used by the message renderer in place of plain markdown for grounded answers.
 */
export function renderWithCitations(
  text: string,
  sources: Source[],
  dark: boolean,
): React.ReactNode[] {
  const parts = linkifyCitations(text, sources ?? []);
  return parts.map((part, i) => {
    if (part.type === 'cite') {
      return (
        <InlineCitation key={`c${i}`} index={part.index} source={part.source} dark={dark} />
      );
    }
    return <React.Fragment key={`t${i}`}>{part.value}</React.Fragment>;
  });
}
