/**
 * Project naming and folder labelling (#542, #543).
 *
 * The project-first flow names a project from its folder immediately, then
 * refines it from the user's first prompt the way the Claude GUI does — so a
 * project is never nameless, and never stuck with a generic folder name once
 * the user has said what they are actually doing.
 */

/** Last path segment of a folder, tolerant of trailing separators and Windows paths. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Compact label for a project's folder set: the primary folder's basename, plus
 * a count when the project spans several repositories (#492).
 */
export function folderLabel(roots: string[]): string {
  if (roots.length === 0) return '';
  const first = basename(roots[0]);
  return roots.length > 1 ? `${first} +${roots.length - 1}` : first;
}

/** Upper bound on a derived project name, so the rail never overflows. */
export const MAX_PROJECT_NAME = 40;

/**
 * Derive a project name from the user's first prompt, Claude-style.
 *
 * Takes the first sentence or line, strips slash-commands and surrounding
 * punctuation, collapses whitespace, and truncates on a word boundary.
 * Returns null when the prompt yields nothing usable, so the caller keeps the
 * folder-derived name rather than replacing it with something worse.
 */
export function deriveProjectName(prompt: string): string | null {
  let text = (prompt ?? '').trim();
  if (!text) return null;
  // A slash command is an instruction to the app, not a description of work.
  if (text.startsWith('/')) return null;
  // First line, then first sentence within it.
  text = text.split('\n')[0].trim();
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  text = sentence.replace(/\s+/g, ' ').replace(/^[\s"'`*#>-]+|[\s"'`*.]+$/g, '').trim();
  if (!text) return null;

  if (text.length > MAX_PROJECT_NAME) {
    const cut = text.slice(0, MAX_PROJECT_NAME);
    const lastSpace = cut.lastIndexOf(' ');
    text = (lastSpace > MAX_PROJECT_NAME * 0.5 ? cut.slice(0, lastSpace) : cut).trim() + '…';
  }
  return text || null;
}

/**
 * True if `name` still looks auto-generated from `roots`, i.e. the user has not
 * renamed the project themselves. Only such names get replaced by the
 * first-prompt derivation — a deliberate rename must never be overwritten.
 */
export function isAutoFolderName(name: string, roots: string[]): boolean {
  if (!name) return true;
  return roots.some(r => basename(r) === name);
}
