/**
 * Local RAG pipeline: chunk → embed → BM25 + cosine hybrid search (#118).
 *
 * Uses Ollama /api/embed (or MLX fallback) for embeddings.
 * Stores chunk vectors in KnowledgeDB.ChunkRecord.
 * Retrieval combines BM25 (keyword) and cosine (vector) scores via RRF.
 */

import { getKnowledgeDB, type ChunkRecord } from './db';

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

let _embedFn: ((texts: string[]) => Promise<number[][]>) | null = null;

/** Override the embed function (used in tests and when MLX is active). */
export function setEmbedFn(fn: (texts: string[]) => Promise<number[][]>): void {
  _embedFn = fn;
}

async function embed(texts: string[], ollamaBaseUrl: string, model: string): Promise<number[][]> {
  if (_embedFn) return _embedFn(texts);
  const response = await fetch(`${ollamaBaseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!response.ok) throw new Error(`Ollama embed error: ${response.statusText}`);
  const data = await response.json();
  return data.embeddings as number[][];
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
  opts: { ollamaBaseUrl?: string; embeddingModel?: string } & ChunkOptions = {},
): Promise<void> {
  const {
    ollamaBaseUrl = 'http://localhost:11434',
    embeddingModel = 'nomic-embed-text',
    ...chunkOpts
  } = opts;
  const db = await getKnowledgeDB();
  const files = await db.getFilesByCollection(collectionId);
  for (const file of files) {
    if (!file.text) continue;
    const texts = chunkText(file.text, chunkOpts);
    const embeddings = await embed(texts, ollamaBaseUrl, embeddingModel);
    const chunks: ChunkRecord[] = texts.map((text, i) => ({
      index: i,
      text,
      embedding: embeddings[i],
      tf: computeTf(tokenize(text)),
    }));
    await db.putFile({ ...file, chunks });
  }
}

// ── Retrieve ──────────────────────────────────────────────────────────────────

export async function retrieve(
  collectionIds: string[],
  query: string,
  k = 5,
  opts: { ollamaBaseUrl?: string; embeddingModel?: string } = {},
): Promise<RetrievedChunk[]> {
  const {
    ollamaBaseUrl = 'http://localhost:11434',
    embeddingModel = 'nomic-embed-text',
  } = opts;

  const db = await getKnowledgeDB();
  const queryTokens = tokenize(query);
  const [queryEmb] = await embed([query], ollamaBaseUrl, embeddingModel);

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
