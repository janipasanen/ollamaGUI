/**
 * Browser AX-snapshot parsing + session wiring (#73, frontend half).
 *
 * The Rust CDP engine (`src-tauri/src/ax.rs`) serializes each page's
 * accessibility tree into a compact, indented outline whose actionable lines
 * carry stable `eNN` refs, e.g.:
 *
 *   - form "Login"
 *     - textbox "Email" [ref=e5]
 *     - textbox "***" [ref=e6]
 *     - button "Sign in" [ref=e7]
 *
 * The model reads that outline and acts by ref. This module turns the outline
 * back into a structured ref map the UI/automation layers can index
 * (`{ e5: { role: 'textbox', name: 'Email' } }`), and pushes it into the shared
 * `browserSession` so the rest of the app sees the latest snapshot.
 *
 * Pure parsing here (no Tauri/IPC) so it runs unchanged under vitest/jsdom; the
 * session wiring only touches the in-memory singleton + event bus from
 * `./browser`.
 */

import { browserSession, browserBus, type SnapshotRef } from './browser';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Matches a single actionable outline line and captures its role, name, and ref.
 *
 * Anchored to the `[ref=eNN]` suffix so pure-context lines (headings/landmarks,
 * which the serializer emits *without* a ref) are naturally ignored.
 *
 * Breakdown:
 *   ^\s*-\s+   leading indent, the list bullet, and its spacing
 *   (\w+)      role token (button, textbox, link, …)
 *   \s+"       the space before the quoted name
 *   ([^"]*)    the name, allowing it to be empty (e.g. redacted to "")
 *   "\s+       closing quote + spacing
 *   \[ref=     the literal ref marker
 *   (e\d+)     the eNN ref id
 *   \]\s*$     closing bracket to end of line
 */
const REF_LINE = /^\s*-\s+(\w+)\s+"([^"]*)"\s+\[ref=(e\d+)\]\s*$/;

/**
 * Parse a serialized AX outline into a ref map.
 *
 * Each actionable line (`- <role> "<name>" [ref=eNN]`) becomes an entry
 * `{ [ref]: { role, name } }`. Non-ref lines — context headings/landmarks, blank
 * lines, anything that doesn't match {@link REF_LINE} — are skipped. The redacted
 * name placeholder `***` is preserved verbatim (it is the name as the model sees
 * it), so secret controls remain addressable without leaking their value.
 *
 * @param snapshot the newline-joined outline produced by the Rust serializer.
 * @returns a map of ref id -> `{ role, name }`. Empty when nothing matches.
 */
export function parseSnapshotRefs(
  snapshot: string,
): Record<string, { role: string; name: string }> {
  const refs: Record<string, { role: string; name: string }> = {};
  if (!snapshot) return refs;

  for (const line of snapshot.split('\n')) {
    const m = REF_LINE.exec(line);
    if (!m) continue; // context/blank/non-ref line — ignore
    const [, role, name, ref] = m;
    refs[ref] = { role, name };
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Session wiring
// ---------------------------------------------------------------------------

/**
 * Parse a fresh snapshot and publish it to the shared browser session.
 *
 * Sets `browserSession.lastSnapshotRefs` to the parsed ref map and emits the
 * `snapshot` event on `browserBus` so the UI/automation layers re-render against
 * the new page model. We go through the session's `setLastSnapshotRefs` setter so
 * the emission can never be skipped (the setter both mutates and emits).
 *
 * Each parsed entry is widened to {@link SnapshotRef}; `isSecret` is left
 * undefined here because the redaction already happened server-side (the name is
 * `***`), and the guardrail layer keys off the redacted name / the engine's
 * secret-ref set rather than re-deriving it on the frontend.
 *
 * @param snapshot the serialized AX outline for the freshly loaded page.
 * @returns the parsed ref map that was published (handy for callers/tests).
 */
export function updateSessionSnapshot(
  snapshot: string,
): Record<string, SnapshotRef> {
  const parsed = parseSnapshotRefs(snapshot);
  // setLastSnapshotRefs both stores the map and emits 'snapshot' on browserBus,
  // keeping the single emission path the rest of the app already subscribes to.
  browserSession.setLastSnapshotRefs(parsed);
  return parsed;
}

/**
 * Convenience subscription helper: invoke `cb` with the latest ref map whenever a
 * new snapshot is published. Returns an unsubscribe function. Thin sugar over the
 * bus so callers don't have to remember the `'snapshot'` channel name.
 */
export function onSnapshot(
  cb: (refs: Record<string, SnapshotRef>) => void,
): () => void {
  browserBus.on('snapshot', cb);
  return () => browserBus.off('snapshot', cb);
}
