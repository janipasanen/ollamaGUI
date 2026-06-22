/**
 * File-state checkpoints and rewind (#91).
 *
 * Before a sequence of file edits, the agent creates a checkpoint by reading
 * the current content of every file it will touch. A one-click "Rewind"
 * restores all captured files to their state at checkpoint time.
 *
 * Checkpoints are kept in sessionStorage (ephemeral — they do NOT survive page
 * reloads). This mirrors the CLI pattern where checkpoints are session-local.
 */

import { readFile, writeFile } from './fileTools';
import { toolRegistry } from './tools';

export interface Checkpoint {
  id: string;
  label: string;
  createdAt: number;
  /** path → original content at checkpoint time. */
  files: Record<string, string>;
}

const STORAGE_KEY = 'ollama_gui_checkpoints';

function loadAll(): Checkpoint[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveAll(checkpoints: Checkpoint[]): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(checkpoints));
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
      return `Checkpoint '${ckpt.label}' created (id=${ckpt.id}), captured ${paths.length} file(s).`;
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

  const restored: string[] = [];
  await Promise.all(
    Object.entries(checkpoint.files).map(async ([path, content]) => {
      await writeFile(path, content);
      restored.push(path);
    }),
  );
  return restored;
}
