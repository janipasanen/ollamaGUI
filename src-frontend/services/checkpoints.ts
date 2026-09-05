/**
 * File-state checkpoints and rewind (#91).
 *
 * Before a sequence of file edits, the agent creates a checkpoint by reading
 * the current content of every file it will touch. A one-click "Rewind"
 * restores all captured files to their state at checkpoint time.
 *
 * Checkpoints are kept in an in-memory session store with a best-effort
 * sessionStorage mirror. The memory store is authoritative because browser
 * storage can reject large snapshots at any time.
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
}

const STORAGE_KEY = 'ollama_gui_checkpoints';
const MAX_CHECKPOINTS = 50;

// sessionStorage is only a mirror: a quota failure must not make a checkpoint
// disappear during the current session. The cap keeps the in-memory fallback
// bounded while retaining the most recent checkpoints.
const checkpointMemory = new Map<string, Checkpoint>();
let memoryHydrated = false;

function orderAndCap(checkpoints: Checkpoint[]): Checkpoint[] {
  const retained = checkpoints
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_CHECKPOINTS);

  if (retained.length !== checkpoints.length) {
    checkpointMemory.clear();
    retained.forEach((checkpoint) => checkpointMemory.set(checkpoint.id, checkpoint));
  }

  return retained;
}

function loadAll(): Checkpoint[] {
  if (!memoryHydrated) {
    memoryHydrated = true;
    try {
      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(stored)) {
        stored.forEach((checkpoint) => {
          if (checkpoint && typeof checkpoint.id === 'string') {
            checkpointMemory.set(checkpoint.id, checkpoint as Checkpoint);
          }
        });
      }
    } catch {
      // A malformed or inaccessible mirror must not hide the in-memory store.
    }
  }

  return orderAndCap([...checkpointMemory.values()]);
}

function saveAll(checkpoints: Checkpoint[]): void {
  memoryHydrated = true;
  checkpointMemory.clear();
  checkpoints.slice(0, MAX_CHECKPOINTS).forEach((checkpoint) => {
    checkpointMemory.set(checkpoint.id, checkpoint);
  });

  // Keep trimming the oldest mirror entry until the browser accepts the
  // snapshot. The authoritative memory copy remains complete up to the cap.
  let mirror = orderAndCap([...checkpointMemory.values()]);
  while (true) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(mirror));
      return;
    } catch {
      if (mirror.length === 0) {
        try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* best effort */ }
        return;
      }
      mirror = mirror.slice(0, -1);
    }
  }
}

function makeId(): string {
  return `ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Create a checkpoint by reading the current content of each path.
 * Silently skips files that cannot be read (e.g. not yet created).
 */
export async function createCheckpoint(paths: string[], label: string): Promise<Checkpoint> {
  const files: Record<string, string> = {};
  await Promise.all(
    paths.map(async (path) => {
      try {
        files[path] = await readFile(path);
      } catch {
        // File does not exist yet — not an error, just not captured.
      }
    }),
  );
  const checkpoint: Checkpoint = { id: makeId(), label, createdAt: Date.now(), files };
  const all = loadAll();
  all.unshift(checkpoint);
  saveAll(all);
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

/** Remove a checkpoint by id. */
export function deleteCheckpoint(id: string): void {
  saveAll(loadAll().filter(c => c.id !== id));
}

/** Clear all checkpoints (used in tests and on session end). */
export function clearCheckpoints(): void {
  memoryHydrated = true;
  checkpointMemory.clear();
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* best effort */ }
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
      const requestedPaths = [...new Set(paths)];
      const capturedPaths = new Set(Object.keys(ckpt.files));
      const skippedPaths = requestedPaths.filter(path => !capturedPaths.has(path));
      const skipped = skippedPaths.length > 0
        ? `; skipped (unreadable): ${skippedPaths.join(', ')}`
        : '';
      return `Checkpoint '${ckpt.label}' created (id=${ckpt.id}), captured ${capturedPaths.size} of ${requestedPaths.length} file(s)${skipped}.`;
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
