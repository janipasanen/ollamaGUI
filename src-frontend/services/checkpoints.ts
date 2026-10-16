/**
 * File-state checkpoints and rewind (#91).
 *
 * Before a sequence of file edits, the agent creates a checkpoint by reading
 * the current content of every file it will touch. A one-click "Rewind"
 * restores all captured files to their state at checkpoint time.
 *
 * The authoritative store is an in-memory map, so a full sessionStorage never
 * makes a rewind silently fail (#603): the checkpoint stays restorable for the
 * session. The in-memory map is additionally mirrored to sessionStorage so the
 * checkpoints survive a same-tab reload. That mirror is best-effort — on
 * QuotaExceededError it is dropped (oldest checkpoints evicted first) and the
 * tool result tells the agent the checkpoint is not persisted across reloads.
 */

import { readFile } from './fileTools';
import { proposeEdits } from './diffReview';
import { toolRegistry } from './tools';

export interface Checkpoint {
  id: string;
  label: string;
  createdAt: number;
  /** path → original content at checkpoint time. */
  files: Record<string, string>;
  /** false only when the sessionStorage mirror rejected the write (#603); the
   *  checkpoint is still restorable in this session via the in-memory store. */
  persisted: boolean;
  /** Request paths that were unreadable at checkpoint time (#603). */
  skipped?: string[];
}

const STORAGE_KEY = 'ollama_gui_checkpoints';

/** Hard cap on checkpoints retained in-memory (also bounds the mirror, #603). */
const MAX_CHECKPOINTS = 50;

/**
 * Authoritative in-memory store. The sessionStorage mirror is best-effort: on
 * QuotaExceededError we drop it (evicting the oldest checkpoints first) so a
 * full storage never makes a rewind silently fail (#603).
 */
const store = new Map<string, Checkpoint>();

/**
 * Mirror the in-memory store to sessionStorage. Returns true on success; on
 * QuotaExceededError it evicts the oldest checkpoint(s) and retries, bounded —
 * a fully-quota'd storage never evicts the checkpoint we just created, so the
 * in-memory store always retains it (#603). Returns false only if nothing
 * could be persisted; the in-memory checkpoint is still valid for the session.
 */
function saveAll(): boolean {
  let attempts = 0;
  do {
    try {
      // Serialize newest-first so the mirror matches creation order.
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...store.values()].reverse()));
      return true;
    } catch {
      // Quota exceeded — evict the oldest checkpoint and retry.
      if (store.size <= 1) return false;
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
      attempts++;
    }
  } while (attempts < MAX_CHECKPOINTS);
  return false;
}

/**
 * All checkpoints, newest first. The in-memory store is authoritative; the
 * sessionStorage mirror only fills gaps left by a fresh session (#603).
 */
function loadAll(): Checkpoint[] {
  const result: Checkpoint[] = [...store.values()].reverse();
  const seen = new Set(result.map((c) => c.id));
  try {
    for (const cp of JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]') as Checkpoint[]) {
      if (!seen.has(cp.id)) {
        result.push(cp);
        seen.add(cp.id);
      }
    }
  } catch {
    /* ignore a malformed mirror */
  }
  return result;
}

/** Drop the oldest checkpoints until the in-memory store is within cap (#603). */
function enforceCap(): void {
  while (store.size > MAX_CHECKPOINTS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

function makeId(): string {
  return `ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Create a checkpoint by reading the current content of each path, tracking
 * which paths were unreadable so the result can name them (#603). The
 * checkpoint is always kept in the authoritative in-memory store (#603); the
 * sessionStorage mirror may degrade, reported via `checkpoint.persisted`.
 */
export async function createCheckpoint(paths: string[], label: string): Promise<Checkpoint> {
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  await Promise.all(
    paths.map(async (path) => {
      try {
        files[path] = await readFile(path);
      } catch {
        // File does not exist yet — not an error, just not captured.
        skipped.push(path);
      }
    }),
  );
  const checkpoint: Checkpoint = {
    id: makeId(),
    label,
    createdAt: Date.now(),
    files,
    persisted: false,
    skipped,
  };
  // Keep it in the authoritative in-memory store (capped), then mirror it to
  // sessionStorage, degrading gracefully on quota (#603).
  store.set(checkpoint.id, checkpoint);
  enforceCap();
  checkpoint.persisted = saveAll();
  return checkpoint;
}

/** List all checkpoints, newest first. */
export function listCheckpoints(): Checkpoint[] {
  return loadAll();
}

/** Get a specific checkpoint by id. */
export function getCheckpoint(id: string): Checkpoint | undefined {
  return loadAll().find(c => c.id === id);
}

/** Remove a checkpoint by id (from both the in-memory store and the mirror). */
export function deleteCheckpoint(id: string): void {
  store.delete(id);
  saveAll();
}

/** Clear all checkpoints (used in tests and on session end). */
export function clearCheckpoints(): void {
  store.clear();
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * Register create_checkpoint, list_checkpoints, and rewind_checkpoint tools
 * in the tool registry so the agent can snapshot and restore files (#91/#180).
 * Safe to call multiple times — later registrations are no-ops.
 */
export function registerCheckpointTools(): void {
  if (toolRegistry.getTool('create_checkpoint')) return;

  toolRegistry.registerTool({
    name: 'create_checkpoint',
    description: 'Snapshot the current content of one or more files so they can be restored later. Call this before any sequence of risky file edits.',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to capture.' },
        label: { type: 'string', description: 'Human-readable name for the checkpoint.' },
      },
      required: ['paths', 'label'],
    },
    readOnly: true,
    execute: async (args: unknown) => {
      const { paths, label } = args as { paths: string[]; label: string };
      const ckpt = await createCheckpoint(paths, label);
      // Report the ACTUAL captured count, naming any unreadable paths (#603).
      const captured = Object.keys(ckpt.files).length;
      const skipped = (ckpt.skipped ?? []).filter((p) => paths.includes(p));
      let msg = `Checkpoint '${ckpt.label}' created (id=${ckpt.id}), captured ${captured}`;
      if (skipped.length > 0) {
        msg += ` of ${paths.length} file(s); skipped (unreadable): ${skipped.join(', ')}`;
      } else {
        msg += ` file(s)`;
      }
      // The in-memory store is authoritative (#603); warn only on mirror loss.
      if (!ckpt.persisted) msg += ' (not persisted across reload)';
      msg += '.';
      return msg;
    },
  });

  toolRegistry.registerTool({
    name: 'list_checkpoints',
    description: 'List all active file-state checkpoints for this session.',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
    execute: async () => {
      const all = listCheckpoints();
      if (all.length === 0) return 'No checkpoints.';
      return all.map(c => `${c.id}  "${c.label}"  (${new Date(c.createdAt).toLocaleTimeString()}, ${Object.keys(c.files).length} files)`).join('\n');
    },
  });

  toolRegistry.registerTool({
    name: 'rewind_checkpoint',
    description: 'Restore all files captured in a checkpoint to their saved content. This overwrites current file contents.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Checkpoint id returned by create_checkpoint or list_checkpoints.' },
      },
      required: ['id'],
    },
    execute: async (args: unknown) => {
      const { id } = args as { id: string };
      const restored = await rewindToCheckpoint(id);
      return `Rewound ${restored.length} file(s): ${restored.join(', ')}`;
    },
  });
}

/**
 * Rewind all files captured in the checkpoint to their saved content.
 * Returns the list of paths that were restored.
 */
export async function rewindToCheckpoint(id: string): Promise<string[]> {
  const checkpoint = getCheckpoint(id);
  if (!checkpoint) throw new Error(`Checkpoint '${id}' not found.`);

  const entries = Object.entries(checkpoint.files);
  if (entries.length === 0) return [];

  // Route the restore through the batch diff-review gate (#432) so an
  // autonomous `rewind_checkpoint` tool call overwrites files only after the
  // same review that `apply_patch` / `write_file` enforce — closing a bypass
  // where rewind wrote directly via `writeFile` with no user review. In
  // headless/autonomous mode (no batch callback) every edit is applied, so the
  // behaviour is unchanged for tests and non-UI callers.
  const applied = await proposeEdits(
    entries.map(([path, content]) => ({
      path,
      kind: 'write_file' as const,
      newString: content,
      label: `rewind ${path}`,
    })),
  );
  const restored: string[] = [];
  entries.forEach(([path], i) => { if (applied[i]) restored.push(path); });
  return restored;
}
