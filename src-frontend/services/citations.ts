/**
 * Inline citations / sources for RAG and web answers (#120).
 *
 * When a reply is grounded in retrieved chunks or fetched URLs, the answer text
 * carries numbered `[n]` markers. This module maps those markers to a list of
 * `Source` records (a file chunk or a URL) so the UI can render clickable
 * superscript citations and a collapsible "Sources" list.
 *
 * Sources live on `Message.sources` (see ollama.ts) and therefore round-trip
 * through `storage.saveSession` automatically.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface Source {
  /** Stable id for the source (used as a React key; not the same as the [n] index). */
  id: string;
  /** Human-readable label, e.g. a file name or a domain. */
  label: string;
  /** What this source points at. */
  kind: 'file' | 'url' | 'chunk';
  /** Knowledge-base file id (for 'file'/'chunk' kinds). */
  fileId?: string;
  /** Zero-based chunk index within the file (for 'chunk' kind). */
  chunkIndex?: number;
  /** Target URL (for 'url' kind). */
  url?: string;
  /** Optional title — page title for URLs, or a chunk snippet/heading. */
  title?: string;
}

/** A run of plain text in a linkified answer. */
export interface TextPart {
  type: 'text';
  value: string;
}

/** A resolved `[n]` citation marker in a linkified answer. */
export interface CitePart {
  type: 'cite';
  /** 1-based index as written in the text. */
  index: number;
  /** The source this index resolves to. */
  source: Source;
}

export type LinkifiedPart = TextPart | CitePart;

// ── Marker matching ──────────────────────────────────────────────────────────

// Matches a single bracketed positive integer, e.g. [1], [12]. We deliberately
// avoid matching [0], ranges, or markdown link syntax like [text](url): the
// capture only succeeds on pure digits, and we re-check the following char in
// linkifyCitations so `[1](http://…)` markdown links are left untouched.
const CITE_RE = /\[(\d+)\]/g;

/**
 * Return the distinct `[n]` indices referenced in `text`, 1-based, deduped and
 * sorted ascending. `[0]` is ignored (citations are 1-based). Markdown links of
 * the form `[n](url)` are skipped so they aren't mistaken for citations.
 */
export function parseCitationRefs(text: string): number[] {
  if (!text) return [];
  const found = new Set<number>();
  CITE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITE_RE.exec(text)) !== null) {
    // Skip markdown links: `[1](…)` — the marker is immediately followed by `(`.
    if (text[m.index + m[0].length] === '(') continue;
    const n = parseInt(m[1], 10);
    if (n >= 1) found.add(n);
  }
  return Array.from(found).sort((a, b) => a - b);
}

/**
 * Split `text` into ordered parts, resolving each `[n]` marker to its source.
 *
 * - A marker whose 1-based index has a matching source becomes a `CitePart`.
 * - A marker that is out of range (or `[0]`) is left as literal text so the
 *   reader still sees exactly what the model wrote.
 * - Markdown links `[n](url)` are left as literal text.
 */
export function linkifyCitations(text: string, sources: Source[]): LinkifiedPart[] {
  const parts: LinkifiedPart[] = [];
  if (!text) return parts;
  const safeSources = sources ?? [];

  let cursor = 0;
  CITE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  const pushText = (value: string) => {
    if (!value) return;
    // Merge consecutive text parts so the output stays tidy.
    const last = parts[parts.length - 1];
    if (last && last.type === 'text') last.value += value;
    else parts.push({ type: 'text', value });
  };

  while ((m = CITE_RE.exec(text)) !== null) {
    const markerStart = m.index;
    const markerEnd = markerStart + m[0].length;
    const index = parseInt(m[1], 10);
    const isMarkdownLink = text[markerEnd] === '(';
    const source = index >= 1 ? safeSources[index - 1] : undefined;

    if (isMarkdownLink || !source) {
      // Not a resolvable citation — leave the literal `[n]` in the text stream.
      continue;
    }

    // Flush any text before the marker, then emit the citation.
    pushText(text.slice(cursor, markerStart));
    parts.push({ type: 'cite', index, source });
    cursor = markerEnd;
  }

  pushText(text.slice(cursor));
  return parts;
}

/** True when there is at least one source to show. */
export function hasSources(sources?: Source[]): boolean {
  return Array.isArray(sources) && sources.length > 0;
}

// ── Opening sources ──────────────────────────────────────────────────────────

/**
 * Test seam: set `.open` to intercept the underlying open call. It receives a
 * `{ kind, target }` describing what would be opened, so tests can assert the
 * resolved url/path without touching the Tauri opener plugin.
 */
export const _mocks: { open: ((target: { kind: Source['kind']; target: string }) => void | Promise<void>) | null } = {
  open: null,
};

/**
 * Open the underlying file or link for a source.
 *
 * - `url` sources open in the system browser via @tauri-apps/plugin-opener.
 * - `file`/`chunk` sources open the file via the opener plugin's openPath.
 *
 * Every external dependency is dynamically imported and guarded, so this is a
 * no-op (rather than a crash) when the plugin is unavailable (e.g. dev server).
 */
export async function openSource(source: Source): Promise<void> {
  if (!source) return;

  const target = source.kind === 'url' ? source.url : (source.fileId ?? source.url);
  if (!target) return;

  if (_mocks.open) {
    await _mocks.open({ kind: source.kind, target });
    return;
  }

  try {
    const opener = await import('@tauri-apps/plugin-opener');
    if (source.kind === 'url') {
      // openUrl is the canonical browser-opening entry point.
      if (typeof opener.openUrl === 'function') await opener.openUrl(target);
      else if (typeof (opener as any).open === 'function') await (opener as any).open(target);
    } else {
      // File-backed source: reveal/open the file on disk if we can.
      if (typeof (opener as any).openPath === 'function') await (opener as any).openPath(target);
      else if (typeof (opener as any).open === 'function') await (opener as any).open(target);
      // else: no opener available — fall back to a no-op.
    }
  } catch (e) {
    // Outside Tauri (dev server / tests) the plugin import fails — degrade quietly.
    console.warn(`[citations] openSource unavailable: ${e}`);
  }
}
