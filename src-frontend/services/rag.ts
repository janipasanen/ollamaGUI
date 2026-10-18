/**
 * Local RAG pipeline: chunk → embed → BM25 + cosine hybrid search (#118).
 *
 * Uses Ollama /api/embed (or MLX fallback) for embeddings.
 * Stores chunk vectors in KnowledgeDB.ChunkRecord.
 * Retrieval combines BM25 (keyword) and cosine (vector) scores via RRF.
 */

import { getKnowledgeDB, type ChunkRecord } from './db';
import { ollamaErrorFromResponse } from './ollama';
import { formatErrorLine } from './errorMessages';
import { PROVIDER_TIMEOUTS, timeoutSignal } from './net';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetrievedChunk {
  fileId: string;
  fileName: string;
  collectionId: string;
  chunkIndex: number;
  text: string;
  score: number;
}

export interface ChunkOptions {
  chunkSize?: number;   // characters per chunk (default 800)
  chunkOverlap?: number; // overlap in characters (default 100)
}

// ── Chunking ──────────────────────────────────────────────────────────────────

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const { chunkSize = 800, chunkOverlap = 100 } = opts;
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - chunkOverlap;
  }
  return chunks;
}

// ── Embeddings ────────────────────────────────────────────────────────────────

/**
 * The endpoint dialect to embed against. Every call site (named knowledge,
 * workspace RAG, the `#` picker) must route through this so an OpenAI-compatible
 * server — vLLM, LM Studio, remote Ollama, … — is never sent to Ollama's
 * `/api/embeddings` (#572).
 *   - `openai`  → POST {baseUrl}/v1/embeddings, JSON `{ model, input }` (+ auth)
 *   - `ollama`  → POST {baseUrl}/api/embeddings, native Ollama dialect
 */
export interface EmbedTarget {
  baseUrl: string;
  kind: 'ollama' | 'openai';
  model?: string;
  apiKey?: string;
}

let _embedFn: ((texts: string[], target: EmbedTarget) => Promise<number[][]>) | null = null;

/** Override the embed function (used in tests and when MLX is active). The
 *  target is forwarded so an override can be provider-aware too. */
export function setEmbedFn(fn: (texts: string[], target: EmbedTarget) => Promise<number[][]>): void {
  _embedFn = fn;
}

/**
 * Embed `texts` against the endpoint dialect described by `target`.
 *
 * Does not swallow failures — any network/API error is thrown so the caller
 * can decide how to degrade (#572): `indexCollection` skips the file, `retrieve`
 * drops the cosine term and still ranks by BM25. The `_embedFn` override may
 * return `[]` to signal "no embeddings available" and keep the UI responsive.
 */
export async function embed(texts: string[], target: EmbedTarget): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (_embedFn) return await _embedFn(texts, target);
  if (target.kind === 'openai') return await embedOpenAi(texts, target);
  return await embedOllama(texts, target);
}

/** Native Ollama embed (`POST {baseUrl}/api/embeddings`). */
async function embedOllama(texts: string[], target: EmbedTarget): Promise<number[][]> {
  const model = target.model ?? 'nomic-embed-text';
  const url = `${target.baseUrl.replace(/\/$/, '')}/api/embeddings`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
    signal: timeoutSignal(PROVIDER_TIMEOUTS.embeddings),
  });
  if (!response.ok) throw await ollamaErrorFromResponse(response, 'Ollama embed error');
  const data = (await response.json()) as { embeddings?: number[][]; embedding?: number[][] };
  return data.embeddings ?? data.embedding ?? [];
}

/** OpenAI-compatible embed (`POST {baseUrl}/v1/embeddings`). Honors `apiKey`. */
async function embedOpenAi(texts: string[], target: EmbedTarget): Promise<number[][]> {
  const model = target.model ?? 'nomic-embed-text';
  const url = `${target.baseUrl.replace(/\/$/, '')}/v1/embeddings`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
    },
    body: JSON.stringify({ model, input: texts }),
    signal: timeoutSignal(PROVIDER_TIMEOUTS.embeddings),
  });
  if (!response.ok) {
    // OpenAI-dialect servers report the reason in body.error.
    let bodyErr: string | undefined;
    try { bodyErr = (await response.json()).error as string | undefined; } catch { /* ignore */ }
    throw new Error(`${response.status} ${response.statusText}${bodyErr ? `: ${bodyErr}` : ''}`);
  }
  const data = (await response.json()) as { data?: Array<{ embedding: number[] }> };
  return (data.data ?? []).map((d) => d.embedding);
}

// ── BM25 ──────────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\b[a-z0-9]+\b/g) ?? [];
}

function computeTf(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
  return tf;
}

function bm25Score(
  queryTokens: string[],
  docTf: Record<string, number>,
  docLen: number,
  avgDocLen: number,
  idf: Record<string, number>,
  k1 = 1.5,
  b = 0.75,
): number {
  let score = 0;
  for (const t of queryTokens) {
    const tf = docTf[t] ?? 0;
    const idfVal = idf[t] ?? 0;
    score += idfVal * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen))));
  }
  return score;
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Reciprocal Rank Fusion ────────────────────────────────────────────────────

function rrfFuse(rankedLists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranked of rankedLists) {
    ranked.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    });
  }
  return scores;
}

// ── Index ─────────────────────────────────────────────────────────────────────

export async function indexCollection(
  collectionId: string,
  opts: { ollamaBaseUrl?: string; embeddingModel?: string; kind?: EmbedTarget['kind']; apiKey?: string } & ChunkOptions = {},
): Promise<void> {
  const {
    ollamaBaseUrl = 'http://localhost:11434',
    embeddingModel = 'nomic-embed-text',
    kind = 'ollama',
    apiKey,
    ...chunkOpts
  } = opts;
  const db = await getKnowledgeDB();
  const files = await db.getFilesByCollection(collectionId);
  const target: EmbedTarget = { baseUrl: ollamaBaseUrl, kind, model: embeddingModel, apiKey };
  for (const file of files) {
    if (!file.text) continue;
    try {
      const texts = chunkText(file.text, chunkOpts);
      const embeddings = await embed(texts, target);
      const chunks: ChunkRecord[] = texts.map((text, i) => ({
        index: i,
        text,
        embedding: embeddings[i],
        tf: computeTf(tokenize(text)),
      }));
      await db.putFile({ ...file, chunks });
    } catch (err) {
      // #572: if embedding is unavailable, skip this file rather than aborting
      // the whole collection — already-indexed files keep working.
      console.error('indexCollection: embedding failed, skipping file:', formatErrorLine(err, kind === 'openai' ? 'openai-compatible' : 'ollama', { label: ollamaBaseUrl, baseUrl: ollamaBaseUrl }));
    }
  }
}

// ── Retrieve ──────────────────────────────────────────────────────────────────

export async function retrieve(
  collectionIds: string[],
  query: string,
  k = 5,
  opts: { ollamaBaseUrl?: string; embeddingModel?: string; kind?: EmbedTarget['kind']; apiKey?: string } = {},
): Promise<RetrievedChunk[]> {
  const {
    ollamaBaseUrl = 'http://localhost:11434',
    embeddingModel = 'nomic-embed-text',
    kind = 'ollama',
    apiKey,
  } = opts;

  const db = await getKnowledgeDB();
  const queryTokens = tokenize(query);

  // #572: degrade gracefully — if embedding fails, drop the cosine term and
  // keep BM25 ranking rather than crashing the chat.
  let queryEmb: number[] | undefined;
  try {
    const [emb] = await embed([query], { baseUrl: ollamaBaseUrl, kind, model: embeddingModel, apiKey });
    queryEmb = emb;
  } catch (err) {
    console.error('retrieve: embedding failed, falling back to BM25:', formatErrorLine(err, kind === 'openai' ? 'openai-compatible' : 'ollama', { label: ollamaBaseUrl, baseUrl: ollamaBaseUrl }));
  }

  // Collect all indexed chunks across all collections
  const allChunks: Array<{
    key: string; fileId: string; fileName: string; collectionId: string;
    chunk: ChunkRecord; docLen: number;
  }> = [];

  for (const collectionId of collectionIds) {
    const files = await db.getFilesByCollection(collectionId);
    for (const file of files) {
      if (!file.chunks?.length) continue;
      const docLen = file.chunks.reduce((s, c) => s + tokenize(c.text).length, 0) / file.chunks.length;
      for (const chunk of file.chunks) {
        allChunks.push({ key: `${file.id}:${chunk.index}`, fileId: file.id, fileName: file.name, collectionId, chunk, docLen });
      }
    }
  }

  if (allChunks.length === 0) return [];

  // IDF over corpus
  const docCount = allChunks.length;
  const df: Record<string, number> = {};
  for (const { chunk } of allChunks) { for (const t of Object.keys(chunk.tf ?? {})) df[t] = (df[t] ?? 0) + 1; }
  const idf: Record<string, number> = {};
  for (const [t, n] of Object.entries(df)) idf[t] = Math.log((docCount - n + 0.5) / (n + 0.5) + 1);
  const avgLen = allChunks.reduce((s, { chunk }) => s + tokenize(chunk.text).length, 0) / docCount;

  // BM25 ranking
  const bm25Ranked = [...allChunks]
    .map(r => ({ key: r.key, score: bm25Score(queryTokens, r.chunk.tf ?? {}, r.docLen, avgLen, idf) }))
    .sort((a, b) => b.score - a.score)
    .map(r => r.key);

  // Cosine ranking
  const cosineRanked = queryEmb
    ? [...allChunks]
        .map(r => ({ key: r.key, score: r.chunk.embedding ? cosine(queryEmb, r.chunk.embedding) : 0 }))
        .sort((a, b) => b.score - a.score)
        .map(r => r.key)
    : bm25Ranked;

  // RRF fusion
  const rrfScores = rrfFuse([bm25Ranked, cosineRanked]);
  const topKeys = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([key]) => key);

  return topKeys.map(key => {
    const r = allChunks.find(c => c.key === key)!;
    return {
      fileId: r.fileId,
      fileName: r.fileName,
      collectionId: r.collectionId,
      chunkIndex: r.chunk.index,
      text: r.chunk.text,
      score: rrfScores.get(key) ?? 0,
    };
  });
}
