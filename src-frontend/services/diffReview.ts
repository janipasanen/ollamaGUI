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
  /** For per-hunk accept: the merged newString applying only accepted hunks (#254). */
  mergedNewString?: string;
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

// ── Edit-applied callback (#401, Aider auto-commit parity) ───────────────────
// Fired after every edit is successfully written to disk, so the host can
// auto-commit, refresh the file tree, etc.
export type EditAppliedCallback = (path: string, label?: string) => void | Promise<void>;

let _editAppliedCallback: EditAppliedCallback | null = null;

export function setEditAppliedCallback(cb: EditAppliedCallback): void {
  _editAppliedCallback = cb;
}

export function clearEditAppliedCallback(): void {
  _editAppliedCallback = null;
}

async function notifyEditApplied(path: string, label?: string): Promise<void> {
  if (_editAppliedCallback) {
    try { await _editAppliedCallback(path, label); } catch { /* best-effort */ }
  }
}
export function getPendingEdits(): PendingEdit[] {
  return Array.from(_pending.values());
}

export function clearPendingEdits(): void {
  _pending.clear();
}

// ── Batch (multi-file) diff review (#400, Codex GUI / Cursor parity) ──────────
//
// When a single tool call proposes several file edits (e.g. apply_patch with
// multiple ops), present them in ONE review instead of N sequential popups.

export type BatchReviewCallback = (edits: PendingEdit[]) => Promise<EditDecision[]>;

let _batchReviewCallback: BatchReviewCallback | null = null;

export function setBatchReviewCallback(cb: BatchReviewCallback): void {
  _batchReviewCallback = cb;
}

export function clearBatchReviewCallback(): void {
  _batchReviewCallback = null;
}

/**
 * Propose several file edits for one combined user review.
 *
 * If a batch review callback is registered the user sees a single multi-file
 * review and can accept/reject per file (and Accept/Reject All). Without a
 * callback every edit is applied immediately (autonomous / headless mode).
 *
 * Returns one boolean per input edit (in order): true if applied.
 */
export async function proposeEdits(
  edits: Array<Omit<PendingEdit, 'id' | 'createdAt'>>,
): Promise<boolean[]> {
  const pending: PendingEdit[] = edits.map(e => ({ ...e, id: makeEditId(), createdAt: Date.now() }));
  for (const p of pending) _pending.set(p.id, p);

  let decisions: EditDecision[] | undefined;
 if (_batchReviewCallback) {
   decisions = await _batchReviewCallback(pending);
   for (const p of pending) _pending.delete(p.id);
 } else {
   // No batch callback: fall back to the single-edit callback per edit (so the
   // existing single-file modal still works), or apply all if neither is set.
   if (_reviewCallback) {
     decisions = [];
     for (const p of pending) {
       const d = await _reviewCallback(p);
       _pending.delete(p.id);
       decisions.push(d);
     }
   } else {
     decisions = pending.map(p => ({ id: p.id, accepted: true }));
     for (const p of pending) _pending.delete(p.id);
   }
 }

  const results: boolean[] = [];
  for (const edit of pending) {
    const dec = decisions?.find(d => d.id === edit.id);
    const accepted = dec?.accepted ?? false;
    if (!accepted) { results.push(false); continue; }
    const newContent = dec?.mergedNewString ?? edit.newString;
    try {
      if (edit.kind === 'apply_edit' && edit.oldString !== undefined) {
        await applyEdit(edit.path, edit.oldString, newContent);
      } else {
        await writeFile(edit.path, newContent);
      }
      await notifyEditApplied(edit.path, edit.label);
      results.push(true);
    } catch {
      results.push(false);
    }
  }
  return results;
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

  let decision: EditDecision | undefined;
  if (_reviewCallback) {
    decision = await _reviewCallback(pending);
    _pending.delete(pending.id);
    if (!decision.accepted) return false;
  } else {
    _pending.delete(pending.id);
  }

  // Apply. For per-hunk accept, use the merged content if provided (#254).
  const newContent = decision?.mergedNewString ?? pending.newString;
  if (pending.kind === 'apply_edit' && pending.oldString !== undefined) {
    await applyEdit(pending.path, pending.oldString, newContent);
  } else {
    await writeFile(pending.path, newContent);
  }
  await notifyEditApplied(pending.path, pending.label);
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
  await notifyEditApplied(edit.path, edit.label);
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

/**
 * A maximal run of consecutive added/removed lines (a change region) within a
 * diff. Context lines separate hunks. Used for per-hunk accept/reject (#254).
 */
export interface DiffHunk {
  index: number;
  /** Indices into the DiffLine[] array that belong to this hunk. */
  lineIndices: number[];
}

/** Group consecutive change lines (added/removed) into hunks (#254). */
export function groupHunks(lines: DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: number[] = [];
  lines.forEach((l, i) => {
    if (l.kind === 'added' || l.kind === 'removed') {
      current.push(i);
    } else if (current.length > 0) {
      hunks.push({ index: hunks.length, lineIndices: current });
      current = [];
    }
  });
  if (current.length > 0) hunks.push({ index: hunks.length, lineIndices: current });
  return hunks;
}

/**
 * Reconstruct the merged content applying only the accepted hunks (#254).
 *
 * - context lines are always kept;
 * - an accepted hunk's added lines are included and its removed lines dropped;
 * - a rejected hunk's added lines are dropped and its removed lines kept
 *   (i.e. the original text is preserved for that region).
 */
export function mergeHunks(lines: DiffLine[], accepted: boolean[]): string {
  const hunks = groupHunks(lines);
  const lineToHunk = new Map<number, number>();
  for (const h of hunks) for (const i of h.lineIndices) lineToHunk.set(i, h.index);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === 'context') {
      out.push(l.text);
      continue;
    }
    const hunkIdx = lineToHunk.get(i)!;
    const isAccepted = accepted[hunkIdx];
    if (l.kind === 'added') {
      if (isAccepted) out.push(l.text);
    } else {
      // removed
      if (!isAccepted) out.push(l.text);
    }
  }
  return out.join('\n');
}
