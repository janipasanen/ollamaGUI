/**
 * @-mention file / directory context injection (#86).
 *
 * Similar to the # command (hashCommand.ts) but for workspace files.
 * Typing `@filename` in the chat input opens an autocomplete list of files
 * within the current workspace and injects the selected file's content as
 * a context block prepended to the user message.
 */

import { listDir, readFile, getWorkspaceRoot } from './fileTools';

export interface AtOption {
  kind: 'file' | 'dir';
  path: string;
  label: string;
}

/** Returns true when the input ends with a standalone @ or @<query>. */
export function isAtTrigger(input: string): boolean {
  return /@\S*$/.test(input);
}

/** Extract the query fragment following the last @. */
export function atQuery(input: string): string {
  const m = input.match(/@(\S*)$/);
  return m ? m[1] : '';
}

/**
 * Return autocomplete options matching `query` from the workspace root.
 * Lists the root, then flat-maps one level of subdirectory contents.
 */
export async function getAtOptions(query: string): Promise<AtOption[]> {
  const root = getWorkspaceRoot();
  if (!root) return [];

  try {
    const entries = await listDir(root);
    const flat: AtOption[] = entries.map(e => ({
      kind: e.is_dir ? 'dir' : 'file',
      path: e.path,
      label: e.name,
    }));

    const q = query.toLowerCase();
    const filtered = q ? flat.filter(o => o.label.toLowerCase().includes(q)) : flat;
    return filtered.slice(0, 20);
  } catch {
    return [];
  }
}

/** Read a file and return it formatted as a context block for the prompt. */
export async function buildAtContextBlock(path: string, label: string): Promise<string> {
  try {
    const content = await readFile(path);
    const truncated = content.length > 32_000
      ? content.slice(0, 32_000) + '\n[…truncated]'
      : content;
    return `<file path="${label}">\n${truncated}\n</file>`;
  } catch (e) {
    return `<file path="${label}">[Error reading file: ${e}]</file>`;
  }
}

/**
 * Substitute the @mention at the end of `input` with a `<file>` context block.
 * Returns the modified input string.
 */
export async function resolveAtMention(input: string, selectedPath: string, selectedLabel: string): Promise<string> {
  const block = await buildAtContextBlock(selectedPath, selectedLabel);
  // Replace trailing @<query> with the context block
  return input.replace(/@\S*$/, block);
}
