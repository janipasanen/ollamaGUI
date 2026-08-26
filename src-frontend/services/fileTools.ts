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
import { proposeEdit, proposeEdits } from './diffReview';

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
  const { invoke } = await import('@tauri-apps/api');
  return invoke<T>(cmd, args);
}

let _workspaceRoot: string | null = null;
let _workspaceRoots: string[] = [];

export function getWorkspaceRoot(): string | null {
  return _workspaceRoot;
}

/** Set the workspace root both in-process and in the Rust backend. */
export async function setWorkspaceRoot(path: string): Promise<void> {
  await tauriInvoke<void>('set_workspace_root', { path });
  _workspaceRoot = path;
  _workspaceRoots = [path];
}

/**
 * Expose several folders at once (#492). The first is the primary root that
 * relative paths resolve against; every listed folder is granted access so a
 * project can span multiple repositories.
 */
export async function setWorkspaceRoots(paths: string[]): Promise<void> {
  await tauriInvoke<void>('set_workspace_roots', { paths });
  _workspaceRoots = [...paths];
  _workspaceRoot = paths[0] ?? null;
}

/** Every folder currently exposed, primary first (#492). */
export function getWorkspaceRoots(): string[] {
  return [..._workspaceRoots];
}

/** Clear the in-process workspace root (used by closeWorkspace for consistency, #380). */
export function clearWorkspaceRoot(): void {
  _workspaceRoot = null;
  _workspaceRoots = [];
}

export async function readFile(path: string, offset?: number, limit?: number): Promise<string> {
  return tauriInvoke<string>('read_file', { path, offset: offset ?? null, limit: limit ?? null });
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

/** Delete a file within the workspace (#397 — apply_patch delete op). */
export async function deleteFile(path: string): Promise<void> {
  return tauriInvoke<void>('delete_file', { path });
}

/** Move/rename a file within the workspace (#421). */
export async function movePath(from: string, to: string): Promise<void> {
  return tauriInvoke<void>('move_path', { from, to });
}

/** Copy a file within the workspace (#421). */
export async function copyPath(from: string, to: string): Promise<void> {
  return tauriInvoke<void>('copy_path', { from, to });
}

/** Create a directory (and missing parents) within the workspace (#421). */
export async function createDir(path: string): Promise<void> {
  return tauriInvoke<void>('create_dir', { path });
}

/** A single file:line match from {@link searchFiles} (#420). */
export interface SearchHit {
  file: string;
  line: number;
  text: string;
}

export interface SearchOptions {
  isRegex?: boolean;
  caseSensitive?: boolean;
  includeGlob?: string;
  maxResults?: number;
}

/** Literal or regex code search across the workspace (#420). */
export async function searchFiles(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  return tauriInvoke<SearchHit[]>('search_files', {
    query,
    isRegex: opts.isRegex ?? false,
    caseSensitive: opts.caseSensitive ?? false,
    includeGlob: opts.includeGlob ?? null,
    maxResults: opts.maxResults ?? null,
  });
}

/** Resolve a path glob (double-star crosses directories) to matching
 *  workspace-relative paths, e.g. a recursive "*.ts" pattern under src (#420). */
export async function globFiles(pattern: string, maxResults?: number): Promise<string[]> {
  return tauriInvoke<string[]>('glob_files', { pattern, maxResults: maxResults ?? null });
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerFileTools(): void {
  toolRegistry.registerTool({
    name: 'read_file',
    description: 'Read the text content of a file within the workspace. Optionally pass offset (1-indexed start line) and limit (line count) to read only a range of a large file.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (absolute or relative to workspace root)' },
        offset: { type: 'number', description: '1-indexed start line (optional).' },
        limit: { type: 'number', description: 'Number of lines to read from offset (optional).' },
      },
      required: ['path'],
    },
    execute: async (params: Record<string, unknown>) => {
      const content = await readFile(
        params.path as string,
        params.offset as number | undefined,
        params.limit as number | undefined,
      );
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
    readOnly: true,
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

  // Multi-file apply_patch tool (#397, Codex CLI parity).
  // Applies many file operations in one shot. Each update/create routes through
  // proposeEdit so the user sees the same inline diff review as apply_edit /
  // write_file; delete routes through the Rust delete_file command.
  type PatchOp =
    | { op: 'update'; path: string; old_string: string; new_string: string }
    | { op: 'create'; path: string; content: string }
    | { op: 'delete'; path: string };

  toolRegistry.registerTool({
    name: 'apply_patch',
    description:
      'Apply multiple file edits in one call (Codex CLI apply_patch parity). ' +
      'operations: [{op:"update",path,old_string,new_string}, ' +
      '{op:"create",path,content}, {op:"delete",path}]. ' +
      'Each op goes through diff review; returns a per-op success summary.',
    parameters: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'Ordered list of file operations to apply.',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['update', 'create', 'delete'], description: 'The operation kind.' },
              path: { type: 'string', description: 'File path within the workspace.' },
              old_string: { type: 'string', description: 'For update: exact string to replace (must appear exactly once).' },
              new_string: { type: 'string', description: 'For update: replacement string.' },
              content: { type: 'string', description: 'For create: full file content.' },
            },
            required: ['op', 'path'],
          },
        },
      },
      required: ['operations'],
    },
    execute: async (params: Record<string, unknown>) => {
     const ops = (params.operations as PatchOp[]) ?? [];
      // Route all update/create ops through ONE batch diff review (#400) when
      // there are several; deletes are applied directly. Per-op results are
      // returned in the original order.
      const reviewableIdx: number[] = [];
      const reviewableEdits: Array<{ path: string; kind: 'apply_edit' | 'write_file'; oldString?: string; newString: string; label: string }> = [];
      for (let i = 0; i < ops.length; i++) {
        const o = ops[i];
        if (o.op === 'update') {
          reviewableIdx.push(i);
          reviewableEdits.push({ path: o.path, kind: 'apply_edit', oldString: o.old_string, newString: o.new_string, label: `update ${o.path}` });
        } else if (o.op === 'create') {
          reviewableIdx.push(i);
          reviewableEdits.push({ path: o.path, kind: 'write_file', newString: o.content, label: `create ${o.path}` });
        }
      }
      const reviewResults = reviewableEdits.length > 0 ? await proposeEdits(reviewableEdits) : [];
      const reviewApplied = new Map<number, boolean>();
      reviewableIdx.forEach((opIdx, k) => reviewApplied.set(opIdx, reviewResults[k] ?? false));

      const results: Array<{ op: string; path: string; success: boolean; error?: string }> = [];
      let allOk = true;
      for (let i = 0; i < ops.length; i++) {
        const operation = ops[i];
        try {
          if (operation.op === 'update' || operation.op === 'create') {
            const applied = reviewApplied.get(i) ?? false;
            results.push({ op: operation.op, path: operation.path, success: applied, ...(applied ? {} : { error: 'rejected or failed' }) });
            if (!applied) allOk = false;
          } else if (operation.op === 'delete') {
            await deleteFile(operation.path);
            results.push({ op: operation.op, path: operation.path, success: true });
          } else {
            const unknown = operation as { op: string; path?: string };
            results.push({ op: unknown.op, path: unknown.path ?? '(unknown)', success: false, error: `Unknown op '${unknown.op}'` });
            allOk = false;
          }
        } catch (err) {
          results.push({
            op: operation.op,
            path: operation.path,
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
          allOk = false;
        }
      }
      return { success: allOk, applied: results.filter(r => r.success).length, total: ops.length, results };
    },
  });

  // Literal / regex code search across the workspace (#420).
  toolRegistry.registerTool({
    name: 'search_files',
    description:
      'Search the workspace for a string or regex and return structured file:line matches. ' +
      'Prefer this over shell grep — it is fast, needs no approval, and skips node_modules/.git/target/dist. ' +
      'Set is_regex:true for a regex pattern. Optionally restrict to files matching include_glob (e.g. "src/**/*.ts").',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The text or regex to search for.' },
        is_regex: { type: 'boolean', description: 'Treat query as a regular expression (default false).' },
        case_sensitive: { type: 'boolean', description: 'Case-sensitive match (default false).' },
        include_glob: { type: 'string', description: 'Only search files whose path matches this glob (e.g. "**/*.rs").' },
        max_results: { type: 'number', description: 'Max hits to return (default 200).' },
      },
      required: ['query'],
    },
    execute: async (params: Record<string, unknown>) => {
      const hits = await searchFiles(params.query as string, {
        isRegex: params.is_regex as boolean | undefined,
        caseSensitive: params.case_sensitive as boolean | undefined,
        includeGlob: params.include_glob as string | undefined,
        maxResults: params.max_results as number | undefined,
      });
      return { count: hits.length, hits };
    },
  });

  // Glob / find-files-by-pattern (#420).
  toolRegistry.registerTool({
    name: 'glob_files',
    description:
      'Find files whose workspace-relative path matches a glob pattern (** across dirs, * within a segment, ?). ' +
      'Example: "src/**/*.test.ts". Skips node_modules/.git/target/dist. Returns a sorted list of paths.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The glob pattern, e.g. "src/**/*.ts".' },
        max_results: { type: 'number', description: 'Max paths to return (default 500).' },
      },
      required: ['pattern'],
    },
    execute: async (params: Record<string, unknown>) => {
      const files = await globFiles(params.pattern as string, params.max_results as number | undefined);
      return { count: files.length, files };
    },
  });

  // File operations (#421). These mutate the filesystem, so they are NOT marked
  // readOnly and go through the agent's approval gate in ask/plan mode.
  toolRegistry.registerTool({
    name: 'move_file',
    description: 'Move or rename a file within the workspace. Creates destination parent directories as needed.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source file path within the workspace.' },
        to: { type: 'string', description: 'Destination file path within the workspace.' },
      },
      required: ['from', 'to'],
    },
    execute: async (params: Record<string, unknown>) => {
      await movePath(params.from as string, params.to as string);
      return { success: true };
    },
  });

  toolRegistry.registerTool({
    name: 'copy_file',
    description: 'Copy a file within the workspace (files only). Creates destination parent directories as needed.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source file path within the workspace.' },
        to: { type: 'string', description: 'Destination file path within the workspace.' },
      },
      required: ['from', 'to'],
    },
    execute: async (params: Record<string, unknown>) => {
      await copyPath(params.from as string, params.to as string);
      return { success: true };
    },
  });

  toolRegistry.registerTool({
    name: 'create_directory',
    description: 'Create a directory (and any missing parent directories) within the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path within the workspace.' },
      },
      required: ['path'],
    },
    execute: async (params: Record<string, unknown>) => {
      await createDir(params.path as string);
      return { success: true };
    },
  });

  toolRegistry.registerTool({
    name: 'delete_file',
    description: 'Delete a single file within the workspace. Refuses to delete directories.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path within the workspace.' },
      },
      required: ['path'],
    },
    execute: async (params: Record<string, unknown>) => {
      await deleteFile(params.path as string);
      return { success: true };
    },
  });
}
