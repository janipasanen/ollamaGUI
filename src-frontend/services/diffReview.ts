/**
 * Inline diff review service (#84).
 *
 * When the AI proposes a file edit, the pending edit is stored here until the
 * user accepts or rejects it. Acceptance calls applyEdit (for surgical edits)
 * or writeFile (for full-file writes). Rejection discards the proposal.
 */

import { applyEdit, writeFile } from './fileTools';

export type EditKind = 'apply_edit' | 'write_file';

export interface PendingEdit {
  id: string;
  path: string;
  kind: EditKind;
  /** For apply_edit: the string being replaced. */
  oldString?: string;
  /** For apply_edit: the replacement; for write_file: full new content. */
  newString: string;
  /** Optional label shown in the review UI (e.g. "create config.ts") */
  label?: string;
  createdAt: number;
}

export interface EditDecision {
  id: string;
  accepted: boolean;
}

type ReviewCallback = (edit: PendingEdit) => Promise<EditDecision>;

let _reviewCallback: ReviewCallback | null = null;
const _pending = new Map<string, PendingEdit>();

export function setDiffReviewCallback(cb: ReviewCallback): void {
  _reviewCallback = cb;
}

export function clearDiffReviewCallback(): void {
  _reviewCallback = null;
}

export function getPendingEdits(): PendingEdit[] {
  return Array.from(_pending.values());
}

export function clearPendingEdits(): void {
  _pending.clear();
}

function makeEditId(): string {
  return `edit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Propose a file edit for user review.
 *
 * If a review callback is registered the user sees a diff modal and can
 * Accept or Reject. Without a callback the edit is applied immediately
 * (useful in autonomous / headless mode).
 *
 * Returns `true` if the edit was applied, `false` if rejected/no-op.
 */
export async function proposeEdit(
  edit: Omit<PendingEdit, 'id' | 'createdAt'>,
): Promise<boolean> {
  const pending: PendingEdit = { ...edit, id: makeEditId(), createdAt: Date.now() };
  _pending.set(pending.id, pending);

  if (_reviewCallback) {
    const decision = await _reviewCallback(pending);
    _pending.delete(pending.id);
    if (!decision.accepted) return false;
  } else {
    _pending.delete(pending.id);
  }

  // Apply
  if (pending.kind === 'apply_edit' && pending.oldString !== undefined) {
    await applyEdit(pending.path, pending.oldString, pending.newString);
  } else {
    await writeFile(pending.path, pending.newString);
  }
  return true;
}

/**
 * Accept a pending edit by id (called from the review UI's Accept button).
 */
export async function acceptEdit(id: string): Promise<boolean> {
  const edit = _pending.get(id);
  if (!edit) return false;
  _pending.delete(id);
  if (edit.kind === 'apply_edit' && edit.oldString !== undefined) {
    await applyEdit(edit.path, edit.oldString, edit.newString);
  } else {
    await writeFile(edit.path, edit.newString);
  }
  return true;
}

/**
 * Reject a pending edit by id (called from the review UI's Reject button).
 */
export function rejectEdit(id: string): boolean {
  return _pending.delete(id);
}

// ── Diff line-level helpers (used by the review UI) ──────────────────────────

export type LineKind = 'context' | 'removed' | 'added';

export interface DiffLine {
  kind: LineKind;
  text: string;
  lineNumBefore?: number;
  lineNumAfter?: number;
}

/** Generate a unified-diff-style line array from two strings. */
export function diffLines(before: string, after: string): DiffLine[] {
  // Split, treating the empty string as zero lines (not one empty line).
  const bLines = before === '' ? [] : before.split('\n');
  const aLines = after === '' ? [] : after.split('\n');

  const m = bLines.length;
  const n = aLines.length;

  if (m === 0 && n === 0) return [];

  // Build LCS table bottom-up.
  // lcs[i][j] = LCS length of bLines[i:] and aLines[j:].
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = bLines[i] === aLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let bi = 0;
  let ai = 0;
  while (bi < m || ai < n) {
    if (bi < m && ai < n && bLines[bi] === aLines[ai]) {
      result.push({ kind: 'context', text: bLines[bi], lineNumBefore: bi + 1, lineNumAfter: ai + 1 });
      bi++; ai++;
    } else if (ai < n && (bi >= m || lcs[bi][ai + 1] >= lcs[bi + 1][ai])) {
      // Skipping aLines[ai] (adding it) keeps more LCS than skipping bLines[bi].
      result.push({ kind: 'added', text: aLines[ai], lineNumAfter: ai + 1 });
      ai++;
    } else {
      result.push({ kind: 'removed', text: bLines[bi], lineNumBefore: bi + 1 });
      bi++;
    }
  }
  return result;
}
