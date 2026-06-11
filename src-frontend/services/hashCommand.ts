/**
 * # command: inline knowledge/URL context injection (#119).
 *
 * Detects a leading # in the composer and returns autocomplete options.
 * Selected options become ContextRef chips; at send time they are resolved
 * to grounded text injected as a system context message.
 */

import { listCollections, getFilesForCollection, type KnowledgeCollection, type KnowledgeFile } from './knowledge';
import { retrieve, type RetrievedChunk } from './rag';
import { fetchUrl, type FetchedPage } from './webfetch';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContextRefKind = 'collection' | 'file' | 'url';

export interface ContextRef {
  kind: ContextRefKind;
  id?: string;        // collectionId or fileId
  url?: string;       // for kind='url'
  label: string;
}

export interface ResolvedSource {
  id: string;
  kind: ContextRefKind;
  label: string;
  fileId?: string;
  chunkIndex?: number;
  url?: string;
  text: string;
}

export interface AutocompleteOption {
  kind: ContextRefKind;
  id?: string;
  url?: string;
  label: string;
  sublabel?: string;
}

// ── Trigger detection ─────────────────────────────────────────────────────────

/** Returns true if `input` contains a standalone # token that should open the picker. */
export function isHashTrigger(input: string): boolean {
  return /(?:^|\s)#$/.test(input) || input === '#';
}

/** Returns the # query fragment after the trigger (for filtering options). */
export function hashQuery(input: string): string {
  const m = input.match(/(?:^|\s)#(\S*)$/);
  return m ? m[1] : '';
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

export async function getAutocompleteOptions(query: string): Promise<AutocompleteOption[]> {
  const opts: AutocompleteOption[] = [];

  // Knowledge collections
  const collections = await listCollections();
  for (const col of collections) {
    if (!query || col.name.toLowerCase().includes(query.toLowerCase())) {
      opts.push({ kind: 'collection', id: col.id, label: col.name, sublabel: 'Collection' });
    }
  }

  // Individual files (from all collections)
  for (const col of collections) {
    const files = await getFilesForCollection(col.id);
    for (const f of files) {
      if (!query || f.name.toLowerCase().includes(query.toLowerCase())) {
        opts.push({ kind: 'file', id: f.id, label: f.name, sublabel: col.name });
      }
    }
  }

  // URL option (always last)
  if (!query || 'url'.includes(query.toLowerCase())) {
    opts.push({ kind: 'url', label: 'Reference URL…', sublabel: 'Paste a link' });
  }

  return opts;
}

// ── Source resolution ─────────────────────────────────────────────────────────

export async function resolveContextRef(
  ref: ContextRef,
  query: string,
  opts: { ollamaBaseUrl?: string; embeddingModel?: string; k?: number } = {},
): Promise<ResolvedSource[]> {
  const { k = 5 } = opts;

  if (ref.kind === 'url' && ref.url) {
    const page: FetchedPage = await fetchUrl(ref.url);
    return [{
      id: `url:${ref.url}`,
      kind: 'url',
      label: page.title || ref.url,
      url: ref.url,
      text: page.text.slice(0, 20_000),
    }];
  }

  if (ref.kind === 'collection' && ref.id) {
    const chunks: RetrievedChunk[] = await retrieve([ref.id], query, k, opts);
    return chunks.map(c => ({
      id: `chunk:${c.fileId}:${c.chunkIndex}`,
      kind: 'collection' as const,
      label: c.fileName,
      fileId: c.fileId,
      chunkIndex: c.chunkIndex,
      text: c.text,
    }));
  }

  if (ref.kind === 'file' && ref.id) {
    const chunks: RetrievedChunk[] = await retrieve([], query, k, opts);
    const filtered = chunks.filter(c => c.fileId === ref.id);
    if (filtered.length > 0) {
      return filtered.map(c => ({
        id: `chunk:${c.fileId}:${c.chunkIndex}`,
        kind: 'file' as const,
        label: c.fileName,
        fileId: c.fileId,
        chunkIndex: c.chunkIndex,
        text: c.text,
      }));
    }
    // File not indexed — use raw text
    return [{
      id: `file:${ref.id}`,
      kind: 'file' as const,
      label: ref.label,
      fileId: ref.id,
      text: '(file not yet indexed)',
    }];
  }

  return [];
}

/** Build the grounded system context message from resolved sources. */
export function buildContextBlock(sources: ResolvedSource[]): string {
  if (sources.length === 0) return '';
  const lines = sources.map((s, i) => `[${i + 1}] ${s.label}\n${s.text}`);
  return `Reference context:\n\n${lines.join('\n\n---\n\n')}`;
}
