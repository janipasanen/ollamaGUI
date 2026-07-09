/**
 * Pinned file context (#350) — Aider-style `/add` & `/drop`.
 *
 * Files pinned into the chat context persist across turns (unlike one-shot
 * `@`-mention). Their contents are prepended as `<file path="…">` context
 * blocks on every send until the user drops them with `/drop` or clears the
 * conversation. The list is persisted to localStorage so it survives reloads.
 */

const STORAGE_KEY = 'ollama_gui_pinned_files';

export interface PinnedFile {
  /** Workspace-relative or absolute path — the dedupe key. */
  path: string;
  /** Display label (usually the basename). */
  label: string;
  /** Snapshot of the file content captured at `/add` time. */
  content: string;
}

export function loadPinnedFiles(): PinnedFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is PinnedFile =>
        !!f && typeof f.path === 'string' && typeof f.label === 'string' && typeof f.content === 'string',
    );
  } catch {
    return [];
  }
}

export function savePinnedFiles(files: PinnedFile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
  } catch {
    /* ignore quota / serialization errors */
  }
}

export function clearPinnedFiles(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Add a pinned file, deduping by path (replacing any existing entry). */
export function addPinnedFile(files: PinnedFile[], file: PinnedFile): PinnedFile[] {
  return [...files.filter(f => f.path !== file.path), file];
}

/** Remove a pinned file whose path matches (exact, then basename fallback). */
export function dropPinnedFile(files: PinnedFile[], path: string): PinnedFile[] {
  const target = path.trim();
  if (!target) return files;
  const exact = files.filter(f => f.path !== target);
  if (exact.length !== files.length) return exact;
  // Fallback: match by basename (so `/drop main.ts` works).
  return files.filter(f => f.label !== target && !f.path.endsWith('/' + target));
}

export function findPinnedFile(files: PinnedFile[], path: string): PinnedFile | undefined {
  const target = path.trim();
  return (
    files.find(f => f.path === target) ||
    files.find(f => f.label === target || f.path.endsWith('/' + target))
  );
}

/**
 * Compose the pinned files into a single context block prepended to the user
 * message on send. Mirrors the `@`-mention `<file path="…">` envelope.
 */
export function pinnedContextBlock(files: PinnedFile[]): string {
  if (files.length === 0) return '';
  return files
    .map(f => {
      const truncated =
        f.content.length > 32_000 ? f.content.slice(0, 32_000) + '\n[…truncated]' : f.content;
      return `<file path="${f.path}">\n${truncated}\n</file>`;
    })
    .join('\n\n');
}

/** Human-readable one-line summary for the `/files` banner. */
export function pinnedFilesSummary(files: PinnedFile[]): string {
  if (files.length === 0) return 'No pinned files';
  const totalChars = files.reduce((n, f) => n + f.content.length, 0);
  const list = files.map(f => `  ${f.path} (${f.content.length} chars)`).join('\n');
  return `Pinned files (${files.length}, ${totalChars} chars total):\n${list}`;
}
