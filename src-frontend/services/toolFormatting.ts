/**
 * Pure formatting helpers for inline tool-call + structured-result rendering
 * (#657). Kept free of React so the logic is unit-testable in isolation; the
 * small UI components that consume them live in App.tsx.
 */

export type ToolStatus = 'running' | 'awaiting-approval' | 'completed' | 'failed';

export const STATUS_LABEL: Record<ToolStatus, string> = {
  'running': 'Running…',
  'awaiting-approval': 'Awaiting approval…',
  'completed': 'Completed',
  'failed': 'Failed',
};

// Tools whose results are always presented as structured key/value views, even
// when the payload is a friendly string. Mirrors the common "structured output"
// tools surfaced by OpenAI-compatible harnesses.
export const STRUCTURED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'get_current_time',
  'calculate_time',
  'calculate',
  'text_process',
  'get_current_weather',
  'weather',
]);

const TOOL_ERROR_RE = /^(error|tool blocked)/i;

/** Whether a tool result content represents an error / blocked tool. */
export function isToolError(content: string | undefined): boolean {
  return TOOL_ERROR_RE.test(String(content ?? '').trim());
}

export interface Parsed { ok: boolean; value: unknown; raw?: string; }

/** Parse tool-call arguments from either the OpenAI `.function.arguments` or the raw `.arguments`. */
export function parseToolArgs(toolCall: any): Parsed {
  const raw = toolCall?.function?.arguments ?? toolCall?.arguments;
  if (raw == null) return { ok: false, value: undefined };
  if (typeof raw === 'object') return { ok: true, value: raw };
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return { ok: false, value: undefined };
    try { return { ok: true, value: JSON.parse(t) }; } catch { return { ok: false, value: t, raw: t }; }
  }
  return { ok: false, value: raw };
}

/** Parse a tool result's content as JSON when it is valid JSON. */
export function parseToolResult(content: string | undefined): Parsed {
  if (content == null) return { ok: false, value: undefined };
  const t = String(content).trim();
  if (!t) return { ok: false, value: undefined };
  try { return { ok: true, value: JSON.parse(t) }; } catch { return { ok: false, value: content, raw: t }; }
}

export function isStructuredTool(name: string | undefined): boolean {
  return typeof name === 'string' && STRUCTURED_TOOL_NAMES.has(name);
}

/** A result is structured when it comes from a structured tool or is parseable JSON. */
export function renderAsStructured(name: string | undefined, parsed: Parsed): boolean {
  if (isStructuredTool(name)) return true;
  return parsed.ok && typeof parsed.value === 'object' && parsed.value !== null;
}

/** Compact, single-line preview of a value, used in headers / summaries. */
export function compactPreview(value: unknown, maxTokens = 8): string {
  if (value == null) return 'null';
  if (typeof value === 'string') {
    const s = value.length > 80 ? value.slice(0, 80) + '…' : value;
    return `"${s.replace(/\s+/g, ' ')}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'symbol') return String(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    const head = keys.slice(0, maxTokens)
      .map(k => `${k}: ${compactPreview((value as Record<string, unknown>)[k])}`)
      .join(', ');
    return keys.length > maxTokens ? `{ ${head} …(${keys.length}) }` : `{ ${head} }`;
  }
  return String(value);
}

/** Pretty-print with indentation, truncated to `maxLines` of output. */
export function prettyPrint(value: unknown, maxLines = 200): string {
  let out = '';
  let line = 0;
  const indent = (n: number) => '  '.repeat(n);
  const add = (s: string): void => { out += s; if (s.includes('\n')) line += s.split('\n').length - 1; };
  const walk = (v: unknown, d: number): void => {
    if (v == null) { add('null'); return; }
    if (typeof v === 'string') { add(`"${v}"`); return; }
    if (typeof v === 'number' || typeof v === 'boolean') { add(String(v)); return; }
    if (typeof v === 'bigint') { add(`${v}n`); return; }
    if (Array.isArray(v)) {
      if (v.length === 0) { add('[]'); return; }
      add('[\n');
      for (const item of v) {
        if (line >= maxLines) { add(`${indent(d + 1)}…\n`); return; }
        add(indent(d + 1));
        walk(item, d + 1);
        add(',\n');
      }
      add(indent(d) + ']');
      return;
    }
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) { add('{}'); return; }
    add('{\n');
    for (const k of keys) {
      if (line >= maxLines) { add(`${indent(d + 1)}…\n`); return; }
      add(indent(d + 1) + JSON.stringify(k) + ': ');
      walk(obj[k], d + 1);
      add(',\n');
    }
    add(indent(d) + '}');
  };
  walk(value, 0);
  if (line >= maxLines) out += `\n…(truncated)`;
  return out;
}

/** Number of lines a value would occupy when pretty-printed (for collapse decisions). */
export function prettyLineCount(value: unknown): number {
  return prettyPrint(value, 1_000_000).split('\n').length;
}

/** Top-level key/value rows for a structured value (one level of nesting). */
export function topLevelRows(value: any): Array<{ label: string; value: unknown }> {
  if (Array.isArray(value)) return value.map((v, i) => ({ label: `[${i}]`, value: v }));
  if (value && typeof value === 'object') return Object.entries(value).map(([k, v]) => ({ label: k, value: v }));
  return [];
}
