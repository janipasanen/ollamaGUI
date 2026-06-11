/**
 * RAG over local workspace files (#94).
 *
 * Builds a searchable knowledge collection from files in the active workspace.
 * Text files are chunked and embedded using the same pipeline as named
 * knowledge collections (rag.ts / knowledge.ts).
 *
 * Usage:
 *   await indexWorkspace('/path/to/project', { ollamaBaseUrl, model });
 *   const chunks = await queryWorkspace('how does auth work?', 5, { ollamaBaseUrl, model });
 */

import { listDir, readFile } from './fileTools';
import { createCollection, listCollections, deleteCollection, addFile } from './knowledge';
import { indexCollection, retrieve, type RetrievedChunk } from './rag';
import type { DirEntry } from './fileTools';

// Text file extensions to include when indexing the workspace.
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.cs',
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.css',
  '.sh', '.bash', '.zsh', '.env.example', '.gitignore',
]);

const WORKSPACE_COLLECTION_PREFIX = '__workspace__';

/** Determine whether a filename is a text file we should index. */
function isTextFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/** Recursively collect all text files under `dir` (max depth 8). */
async function collectFiles(dir: string, depth = 0): Promise<DirEntry[]> {
  if (depth > 8) return [];
  let entries: DirEntry[];
  try {
    entries = await listDir(dir);
  } catch {
    return [];
  }
  const result: DirEntry[] = [];
  for (const e of entries) {
    if (e.is_dir) {
      // Skip hidden dirs and common noise directories
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'target' || e.name === 'dist' || e.name === '.git') continue;
      const sub = await collectFiles(e.path, depth + 1);
      result.push(...sub);
    } else if (isTextFile(e.name)) {
      result.push(e);
    }
  }
  return result;
}

function collectionName(workspaceRoot: string): string {
  return `${WORKSPACE_COLLECTION_PREFIX}${workspaceRoot}`;
}

/** Find or create the workspace collection. Returns the collection id. */
async function getOrCreateWorkspaceCollection(workspaceRoot: string): Promise<string> {
  const name = collectionName(workspaceRoot);
  const existing = (await listCollections()).find(c => c.name === name);
  if (existing) return existing.id;
  const col = await createCollection(name, `Workspace: ${workspaceRoot}`);
  return col.id;
}

export interface IndexOptions {
  ollamaBaseUrl?: string;
  model?: string;
  /** Called with progress [0..1]. */
  onProgress?: (ratio: number) => void;
}

/**
 * Index (or re-index) all text files in the workspace.
 * Deletes any existing workspace collection for this root first.
 */
export async function indexWorkspace(workspaceRoot: string, opts: IndexOptions = {}): Promise<string> {
  const name = collectionName(workspaceRoot);
  const existing = (await listCollections()).find(c => c.name === name);
  if (existing) await deleteCollection(existing.id);

  const collectionId = await getOrCreateWorkspaceCollection(workspaceRoot);
  const files = await collectFiles(workspaceRoot);

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    opts.onProgress?.((i + 1) / files.length);
    try {
      const content = await readFile(f.path);
      await addFile(collectionId, f.path, 'text/plain', content.length, content);
    } catch {
      // Skip unreadable files silently
    }
  }

  await indexCollection(collectionId, opts);
  return collectionId;
}

export interface QueryOptions {
  ollamaBaseUrl?: string;
  model?: string;
}

/**
 * Query the workspace knowledge collection.
 * Returns up to `k` relevant chunks, or an empty array if not yet indexed.
 */
export async function queryWorkspace(
  workspaceRoot: string,
  query: string,
  k = 5,
  opts: QueryOptions = {},
): Promise<RetrievedChunk[]> {
  const name = collectionName(workspaceRoot);
  const col = (await listCollections()).find(c => c.name === name);
  if (!col) return [];
  return retrieve([col.id], query, k, opts);
}

/** True if a workspace collection has been indexed. */
export async function isWorkspaceIndexed(workspaceRoot: string): Promise<boolean> {
  const name = collectionName(workspaceRoot);
  return (await listCollections()).some(c => c.name === name);
}
