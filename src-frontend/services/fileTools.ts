/**
 * Filesystem tool registration (#83).
 *
 * Wraps the Rust `read_file` / `write_file` / `list_dir` / `apply_edit`
 * commands in toolRegistry entries so the AI agent can read, list, and edit
 * files within the workspace.
 *
 * Call `setWorkspaceRoot(path)` when the user opens/picks a project folder.
 * All tool calls validate the path is within that root (enforced in Rust too).
 */

import { toolRegistry } from './tools';
import { proposeEdit } from './diffReview';

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_ms: number | null;
}

/** Test seam — override to avoid real Tauri invocations in unit tests. */
export const _mocks = {
  invoke: null as ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null,
};

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (_mocks.invoke) return _mocks.invoke(cmd, args) as Promise<T>;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

let _workspaceRoot: string | null = null;

export function getWorkspaceRoot(): string | null {
  return _workspaceRoot;
}

/** Set the workspace root both in-process and in the Rust backend. */
export async function setWorkspaceRoot(path: string): Promise<void> {
  await tauriInvoke<void>('set_workspace_root', { path });
  _workspaceRoot = path;
}

export async function readFile(path: string): Promise<string> {
  return tauriInvoke<string>('read_file', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return tauriInvoke<void>('write_file', { path, content });
}

export async function listDir(path: string): Promise<DirEntry[]> {
  return tauriInvoke<DirEntry[]>('list_dir', { path });
}

export async function applyEdit(path: string, oldString: string, newString: string): Promise<void> {
  return tauriInvoke<void>('apply_edit', { path, old_string: oldString, new_string: newString });
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerFileTools(): void {
  toolRegistry.registerTool({
    name: 'read_file',
    description: 'Read the text content of a file within the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (absolute or relative to workspace root)' },
      },
      required: ['path'],
    },
    execute: async (params: Record<string, unknown>) => {
      const content = await readFile(params.path as string);
      return { content };
    },
  });

  toolRegistry.registerTool({
    name: 'write_file',
    description: 'Write (overwrite) a file within the workspace with the given content. Creates parent directories as needed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path within workspace' },
        content: { type: 'string', description: 'Full text content to write' },
      },
      required: ['path', 'content'],
    },
    execute: async (params: Record<string, unknown>) => {
      const applied = await proposeEdit({
        path: params.path as string,
        kind: 'write_file',
        newString: params.content as string,
        label: `write ${params.path}`,
      });
      return { success: applied };
    },
  });

  toolRegistry.registerTool({
    name: 'list_dir',
    description: 'List files and subdirectories within a workspace directory. Directories appear first.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path within workspace' },
      },
      required: ['path'],
    },
    execute: async (params: Record<string, unknown>) => {
      const entries = await listDir(params.path as string);
      return { entries };
    },
  });

  toolRegistry.registerTool({
    name: 'apply_edit',
    description: 'Surgically replace an exact string in a file. Fails if the old_string is not found or appears more than once.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path within workspace' },
        old_string: { type: 'string', description: 'Exact string to replace (must appear exactly once)' },
        new_string: { type: 'string', description: 'Replacement string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    execute: async (params: Record<string, unknown>) => {
      const applied = await proposeEdit({
        path: params.path as string,
        kind: 'apply_edit',
        oldString: params.old_string as string,
        newString: params.new_string as string,
        label: `edit ${params.path}`,
      });
      return { success: applied };
    },
  });
}
