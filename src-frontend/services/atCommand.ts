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

/** Returns true when the input ends with a standalone @ or @<query> that starts
 *  at a token boundary (input start or after whitespace) — so emails and
 *  mid-word `@` (e.g. `user@example.com`) do NOT open the file picker (#428). */
export function isAtTrigger(input: string): boolean {
  return /(?:^|\s)@\S*$/.test(input);
}

/** Extract the query fragment following the last token-boundary @. */
export function atQuery(input: string): string {
  const m = input.match(/(?:^|\s)@(\S*)$/);
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
    const rootEntries = await listDir(root);
    const flat: AtOption[] = [];
    for (const e of rootEntries) {
      flat.push({ kind: e.is_dir ? 'dir' : 'file', path: e.path, label: e.name });
      // Expand one level into subdirectories so nested files (e.g. `src/App.tsx`)
      // are @-mentionable — Codex/Claude/Cursor parity (#428). The doc comment
      // always promised this; the previous implementation listed only the root.
      if (e.is_dir) {
        try {
          const subEntries = await listDir(e.path);
          for (const sub of subEntries) {
            flat.push({ kind: sub.is_dir ? 'dir' : 'file', path: sub.path, label: `${e.name}/${sub.name}` });
          }
        } catch { /* unreadable subdir — skip */ }
      }
    }

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
  // Replace the trailing token-boundary @<query> with the context block,
  // preserving any leading whitespace. A function replacement is used so that
  // file content containing `$` (e.g. `$&`, `$1`) is inserted literally instead
  // of being interpreted as String.replace substitution patterns (#428).
  return input.replace(/(^|\s)@\S*$/, (_match, sep: string) => sep + block);
}
