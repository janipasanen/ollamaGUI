/**
 * BrowserToolResult (#75).
 *
 * Renders the result payload of a built-in `browser_*` tool richly in the chat
 * transcript instead of dumping raw JSON. The browser tools (#65 family) produce
 * structured results — a screenshot PNG, an accessibility-tree snapshot outline,
 * a console log array, an assertion verdict — each of which is far more useful
 * shown as an image / collapsible outline / list / pass-fail chip than as a JSON
 * blob.
 *
 * This is a pure, memoised presentational component: it branches on the tool
 * `name`, reads the (already-parsed) `payload`, and themes purely through the
 * `dark` ternary convention used across the app (no CSS variables). Unknown /
 * non-browser names fall through to a JSON `<pre>`, so wiring this in for the
 * `browser_*` names only is non-destructive to every other tool result.
 */

import React from 'react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * True when `name` is one of the built-in browser tools (those whose name starts
 * with `browser_`). App.tsx uses this to decide whether to route a tool message
 * through this rich renderer vs. the default JSON view.
 */
export function isBrowserToolName(name: string): boolean {
  return typeof name === 'string' && name.startsWith('browser_');
}

/**
 * Mirror of App.tsx `toDisplayUrl`, specialised to PNG: a screenshot payload is
 * a raw base64 PNG string. If it already carries a `data:` URI prefix (some
 * engines hand back a full data URL) use it verbatim; otherwise prefix it.
 */
function toPngDisplayUrl(b64: string): string {
  return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
}

/**
 * Count accessibility-tree refs in a snapshot outline. Refs are emitted by the
 * page model as stable `[ref=eNN]` tags (e.g. `[ref=e12]`); we count the
 * occurrences so the collapsed summary can read "Show snapshot (N refs)".
 */
function countRefs(outline: string): number {
  const matches = outline.match(/\[ref=e\d+\]/g);
  return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface BrowserToolResultProps {
  /** The browser tool name, e.g. `browser_screenshot`, `browser_assert`. */
  name: string;
  /** The already-parsed tool result payload (shape depends on `name`). */
  payload: any;
  /** Theme flag (dark vs light), per the app-wide convention. */
  dark: boolean;
}

function BrowserToolResultImpl({ name, payload, dark }: BrowserToolResultProps) {
  switch (name) {
    // ── Screenshot: render the captured PNG inline ──────────────────────────
    case 'browser_screenshot': {
      // Payload may be a bare base64 string or an object carrying `{ image }`.
      const b64: string =
        typeof payload === 'string'
          ? payload
          : (payload && typeof payload.image === 'string' ? payload.image : '');
      if (!b64) {
        return (
          <div className={`text-xs italic ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
            (no screenshot data)
          </div>
        );
      }
      return (
        <img
          data-testid="browser-screenshot"
          src={toPngDisplayUrl(b64)}
          alt="screenshot"
          className={`max-h-96 rounded-lg object-contain border ${
            dark ? 'border-zinc-600' : 'border-zinc-300'
          }`}
        />
      );
    }

    // ── Snapshot: collapsible monospace AX-tree outline ─────────────────────
    case 'browser_snapshot': {
      // Payload is the outline string (or an object carrying it).
      const outline: string =
        typeof payload === 'string'
          ? payload
          : (payload && typeof payload.outline === 'string'
              ? payload.outline
              : (payload && typeof payload.snapshot === 'string' ? payload.snapshot : ''));
      const refCount = countRefs(outline);
      return (
        <details
          data-testid="browser-snapshot"
          className={`rounded border text-xs ${
            dark ? 'border-zinc-600 bg-zinc-800/40' : 'border-zinc-300 bg-zinc-50'
          }`}
        >
          <summary
            className={`cursor-pointer select-none px-2 py-1 font-medium ${
              dark ? 'text-zinc-300' : 'text-zinc-600'
            }`}
          >
            Show snapshot ({refCount} refs)
          </summary>
          <pre
            className={`overflow-auto px-2 py-1 font-mono whitespace-pre-wrap break-words ${
              dark ? 'text-zinc-300' : 'text-zinc-700'
            }`}
          >
            {outline}
          </pre>
        </details>
      );
    }

    // ── Console: styled list of forwarded page console entries ──────────────
    case 'browser_read_console': {
      // Payload is an array of console entries. Each entry may be a string or an
      // object like `{ type, text }`; render a readable line either way.
      const entries: any[] = Array.isArray(payload)
        ? payload
        : (payload && Array.isArray(payload.entries) ? payload.entries : []);
      if (entries.length === 0) {
        return (
          <div className={`text-xs italic ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
            (console is empty)
          </div>
        );
      }
      return (
        <ul
          data-testid="browser-console"
          className={`text-xs font-mono rounded border divide-y ${
            dark
              ? 'border-zinc-600 divide-zinc-700 bg-zinc-800/40'
              : 'border-zinc-300 divide-zinc-200 bg-zinc-50'
          }`}
        >
          {entries.map((entry, idx) => {
            // Normalise the level + text for display.
            const level: string =
              entry && typeof entry === 'object'
                ? (entry.type || entry.level || 'log')
                : 'log';
            const text: string =
              entry && typeof entry === 'object'
                ? (entry.text ?? entry.message ?? JSON.stringify(entry))
                : String(entry);
            // Colour error/warning levels so they stand out.
            const levelColor =
              level === 'error'
                ? (dark ? 'text-red-400' : 'text-red-600')
                : level === 'warn' || level === 'warning'
                  ? (dark ? 'text-yellow-400' : 'text-yellow-600')
                  : (dark ? 'text-zinc-400' : 'text-zinc-500');
            return (
              <li key={idx} className="px-2 py-1 flex gap-2">
                <span className={`shrink-0 uppercase ${levelColor}`}>{level}</span>
                <span className={dark ? 'text-zinc-200' : 'text-zinc-800'}>{text}</span>
              </li>
            );
          })}
        </ul>
      );
    }

    // ── Assert: pass/fail chip with expected vs actual ──────────────────────
    case 'browser_assert': {
      const pass = !!(payload && payload.pass);
      const expected = payload ? payload.expected : undefined;
      const actual = payload ? payload.actual : undefined;
      const fmt = (v: any) =>
        typeof v === 'string' ? v : JSON.stringify(v);
      return (
        <div data-testid="browser-assert" className="text-xs space-y-1">
          <span
            data-testid={pass ? 'browser-assert-pass' : 'browser-assert-fail'}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium ${
              pass
                ? (dark ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-700')
                : (dark ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-700')
            }`}
          >
            {pass ? '✓ passed' : '✗ failed'}
          </span>
          <div className={`font-mono ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>
            <div>
              <span className={dark ? 'text-zinc-500' : 'text-zinc-400'}>expected: </span>
              {fmt(expected)}
            </div>
            <div>
              <span className={dark ? 'text-zinc-500' : 'text-zinc-400'}>actual: </span>
              {fmt(actual)}
            </div>
          </div>
        </div>
      );
    }

    // ── Unknown / non-browser: fall back to raw JSON ────────────────────────
    default:
      return (
        <pre
          data-testid="browser-tool-json"
          className={`text-xs font-mono overflow-auto whitespace-pre-wrap break-words ${
            dark ? 'text-zinc-300' : 'text-zinc-700'
          }`}
        >
          {JSON.stringify(payload, null, 2)}
        </pre>
      );
  }
}

/**
 * Memoised export — tool results are static once produced, so re-rendering on
 * every parent transcript update is wasteful. Mirrors the `React.memo` usage on
 * the other transcript sub-components.
 */
const BrowserToolResult = React.memo(BrowserToolResultImpl);
export default BrowserToolResult;
