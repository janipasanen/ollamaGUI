// The Qwen wire dialect on OpenAI-compatible servers (#551): recovering tool
// calls the server left in the content channel, and splitting inline reasoning
// off the visible text.
//
// Why this exists: LM Studio ships Qwen3-Coder GGUFs with the model's own
// Jinja chat template, which instructs the model to emit tool calls as XML in
// the *content* channel rather than in `delta.tool_calls`. In streaming mode
// LM Studio does not re-parse that XML back into the OpenAI shape (it does in
// non-streaming mode — lmstudio-bug-tracker#1071), so a client that only reads
// `delta.tool_calls` sees a chatty assistant message full of angle brackets
// and the agent loop never runs a single tool. That is the failure this
// module fixes, and it is why opencode-style clients need a content parser at
// all.
//
// The same template family also emits reasoning inline as <think>…</think>
// in the content channel rather than in a `reasoning_content` field, so the
// stream filter below splits both markups off the visible text in one pass.
//
// Two tool-call dialects are recovered, both wrapped in <tool_call>…</tool_call>:
//
//   1. Qwen3-Coder XML (the official Qwen3-Coder template):
//        <tool_call>
//        <function=read_file>
//        <parameter=path>
//        src/lib.rs
//        </parameter>
//        </function>
//        </tool_call>
//
//   2. Qwen2.5 / Qwen3-Instruct JSON (the older template):
//        <tool_call>
//        {"name": "read_file", "arguments": {"path": "src/lib.rs"}}
//        </tool_call>
//
// Parameter values in dialect 1 arrive as raw text with a leading/trailing
// newline from the template's line breaks, and carry no type information —
// `count: 3` and `count: "3"` look identical on the wire. We coerce against
// the declared JSON-schema type of the parameter, exactly as the vLLM and
// Megatron Qwen3-Coder parsers do; without that, a numeric or boolean
// argument reaches the tool as a string and the tool rejects it.

import { ToolCall } from './tools';

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

const TOOL_CALL_BLOCK = /<tool_call>([\s\S]*?)<\/tool_call>/g;
const FUNCTION_BLOCK = /<function=([^>\s]+)>([\s\S]*?)<\/function>/;
const PARAMETER_BLOCK = /<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/g;
/** Fallback dialect: bare <name>value</name> pairs instead of <parameter=name>. */
const BARE_PARAM_BLOCK = /<([A-Za-z_][A-Za-z0-9_-]*)>([\s\S]*?)<\/\1>/g;

/** The tag that opens a tool call — exported so the stream filter stays in sync. */
export const TOOL_CALL_OPEN = '<tool_call>';
export const TOOL_CALL_CLOSE = '</tool_call>';

/** Minimal shape we need from an OpenAI tool definition to coerce arguments. */
interface ToolSchemaLike {
  function?: { name?: string; parameters?: any };
  name?: string;
  parameters?: any;
}

/**
 * Coerce one raw XML parameter value to the type the tool's JSON schema
 * declares. Unknown/absent schema leaves the string untouched — guessing
 * would silently turn a version string like "1.0" into a number.
 */
export function coerceParamValue(raw: string, schema: any): unknown {
  // The Qwen3-Coder template puts the value on its own line, so exactly one
  // leading and one trailing newline are template punctuation, not content.
  let value = raw.replace(/^\n/, '').replace(/\n$/, '');
  const type = schema?.type;
  if (type === 'string' || type === undefined) return value;
  const trimmed = value.trim();
  if (type === 'number' || type === 'integer') {
    const n = Number(trimmed);
    return Number.isNaN(n) ? value : n;
  }
  if (type === 'boolean') {
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    return value;
  }
  if (type === 'object' || type === 'array') {
    try { return JSON.parse(trimmed); } catch { return value; }
  }
  return value;
}

/** Find a tool definition by name, in either definition shape. */
function findDef(tools: ToolSchemaLike[] | undefined, name: string): ToolSchemaLike | undefined {
  return tools?.find(t => (t.function?.name ?? t.name) === name);
}

/**
 * A name is acceptable when no tool list was supplied (caller isn't policing
 * names) or the list actually declares it. Requiring the match matters: a model
 * that merely *writes about* a <tool_call> block in prose must not get it
 * executed.
 */
function nameAllowed(tools: ToolSchemaLike[] | undefined, name: string): boolean {
  if (!tools || tools.length === 0) return true;
  return !!findDef(tools, name);
}

/** Declared parameter properties for a tool, or {} when unknown. */
function propsFor(tools: ToolSchemaLike[] | undefined, name: string): Record<string, any> {
  const def = findDef(tools, name);
  return (def?.function?.parameters ?? def?.parameters)?.properties ?? {};
}

/** Parse one <tool_call> block body into name + arguments, or null if unusable. */
function parseBlock(body: string, tools: ToolSchemaLike[] | undefined): { name: string; args: Record<string, unknown> } | null {
  const trimmed = body.trim();

  // Dialect 2 — JSON payload.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const name = parsed?.name ?? parsed?.function?.name;
      if (typeof name !== 'string' || !name || !nameAllowed(tools, name)) return null;
      const rawArgs = parsed?.arguments ?? parsed?.parameters ?? parsed?.function?.arguments ?? {};
      const args = typeof rawArgs === 'string' ? safeJson(rawArgs) : rawArgs;
      return { name, args: (args && typeof args === 'object') ? args : {} };
    } catch {
      return null;
    }
  }

  // Dialect 1 — XML function/parameter tags.
  const fn = FUNCTION_BLOCK.exec(trimmed);
  if (!fn) return null;
  const name = fn[1];
  if (!nameAllowed(tools, name)) return null;
  const inner = fn[2];
  const props = propsFor(tools, name);
  const args: Record<string, unknown> = {};

  PARAMETER_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  let sawParameterTag = false;
  while ((m = PARAMETER_BLOCK.exec(inner)) !== null) {
    sawParameterTag = true;
    args[m[1]] = coerceParamValue(m[2], props[m[1]]);
  }
  if (!sawParameterTag) {
    // Some repackaged templates drop the `parameter=` prefix and emit the
    // parameter name directly as the tag. Only accept tags the schema knows,
    // so stray markup in a value can't invent arguments.
    BARE_PARAM_BLOCK.lastIndex = 0;
    while ((m = BARE_PARAM_BLOCK.exec(inner)) !== null) {
      if (Object.prototype.hasOwnProperty.call(props, m[1])) {
        args[m[1]] = coerceParamValue(m[2], props[m[1]]);
      }
    }
  }
  return { name, args };
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}

/**
 * Extract Qwen XML/JSON tool calls from assistant *content*.
 *
 * Returns the tool calls in the OpenAI shape (arguments as a JSON string, per
 * OpenAI convention) plus the content with every recognised block removed, so
 * the caller can show the model's prose without the markup.
 *
 * `idPrefix` seeds synthetic call ids: content-channel calls carry no server
 * id, but strict servers (LM Studio, vLLM) reject a role:'tool' message whose
 * tool_call_id doesn't match a preceding call.
 */
export function parseQwenToolCalls(
  content: string,
  tools?: ToolSchemaLike[],
  idPrefix = 'qwen_call',
): { calls: ToolCall[]; cleanedContent: string } {
  const calls: ToolCall[] = [];
  if (!content.includes(TOOL_CALL_OPEN)) return { calls, cleanedContent: content };

  let cleaned = '';
  let lastEnd = 0;
  TOOL_CALL_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOOL_CALL_BLOCK.exec(content)) !== null) {
    const parsed = parseBlock(m[1], tools);
    if (parsed) {
      cleaned += content.slice(lastEnd, m.index);
      lastEnd = m.index + m[0].length;
      calls.push({
        id: `${idPrefix}_${calls.length}`,
        type: 'function',
        function: { name: parsed.name, arguments: JSON.stringify(parsed.args) },
      } as unknown as ToolCall);
    }
    // An unparseable block is left in the content — better shown verbatim
    // than silently swallowed.
  }
  cleaned += content.slice(lastEnd);
  return { calls, cleanedContent: cleaned };
}

// ── Streaming channel split ─────────────────────────────────────────────────

export interface QwenStreamFilter {
  /** Feed one content delta; returns what belongs on each visible channel. */
  push(delta: string): { content: string; reasoning: string };
  /** Call once the stream ends to release anything still buffered. */
  flush(): { content: string; reasoning: string };
  /** Raw <tool_call>…</tool_call> blocks seen so far, wrappers included. */
  toolCallText(): string;
}

export interface QwenStreamFilterOptions {
  /**
   * Divert <tool_call>…</tool_call> spans into `toolCallText()` instead of
   * leaving them in the visible content. Only turn this on if you actually
   * read `toolCallText()` back — otherwise the markup is silently deleted
   * from the reply. The agent loop does; plain chat does not.
   * Defaults to true.
   */
  captureToolCalls?: boolean;
}

/**
 * Split streamed content into up to three channels — visible content,
 * reasoning (<think>…</think>), and, when `captureToolCalls` is on, Qwen's
 * content-embedded tool calls (<tool_call>…</tool_call>) — tolerating tags
 * split across chunk boundaries.
 *
 * The tool-call channel is what makes Qwen3-Coder usable on LM Studio: its
 * chat template emits calls as content markup, so without withholding those
 * spans the user watches raw XML scroll past as if it were the answer.
 */
export function makeQwenStreamFilter(options: QwenStreamFilterOptions = {}): QwenStreamFilter {
  const captureToolCalls = options.captureToolCalls ?? true;
  let mode: 'text' | 'think' | 'tool' = 'text';
  let carry = '';
  let toolText = '';

  // `final` = the stream has ended, so nothing more can arrive to complete a
  // partial tag; stop holding text back and emit what we have.
  const step = (final: boolean) => {
    let content = '';
    let reasoning = '';
    for (;;) {
      if (mode === 'text') {
        const t = carry.indexOf(THINK_OPEN);
        const c = captureToolCalls ? carry.indexOf(TOOL_CALL_OPEN) : -1;
        const useThink = t >= 0 && (c < 0 || t < c);
        const idx = useThink ? t : c;
        if (idx >= 0) {
          const tag = useThink ? THINK_OPEN : TOOL_CALL_OPEN;
          content += carry.slice(0, idx);
          carry = carry.slice(idx + tag.length);
          mode = useThink ? 'think' : 'tool';
          continue;
        }
        const keep = final ? 0 : Math.max(
          partialTagSuffix(carry, THINK_OPEN),
          captureToolCalls ? partialTagSuffix(carry, TOOL_CALL_OPEN) : 0,
        );
        content += carry.slice(0, carry.length - keep);
        carry = carry.slice(carry.length - keep);
        break;
      }
      if (mode === 'think') {
        const close = carry.indexOf(THINK_CLOSE);
        if (close >= 0) {
          reasoning += carry.slice(0, close);
          carry = carry.slice(close + THINK_CLOSE.length);
          mode = 'text';
          continue;
        }
        const keep = final ? 0 : partialTagSuffix(carry, THINK_CLOSE);
        reasoning += carry.slice(0, carry.length - keep);
        carry = carry.slice(carry.length - keep);
        break;
      }
      // mode === 'tool' — buffer silently until the block closes.
      const close = carry.indexOf(TOOL_CALL_CLOSE);
      if (close >= 0) {
        toolText += TOOL_CALL_OPEN + carry.slice(0, close) + TOOL_CALL_CLOSE;
        carry = carry.slice(close + TOOL_CALL_CLOSE.length);
        mode = 'text';
        continue;
      }
      if (final) {
        // Generation was cut off mid-call (hit the token limit). Surface the
        // fragment rather than dropping the turn's only output.
        content += TOOL_CALL_OPEN + carry;
        carry = '';
      }
      break;
    }
    return { content, reasoning };
  };

  return {
    push: (delta: string) => { carry += delta; return step(false); },
    flush: () => step(true),
    toolCallText: () => toolText,
  };
}

/**
 * Back-compat wrapper: <think> filtering only, as a plain per-delta function.
 */
export function makeThinkFilter(): (delta: string) => { content: string; reasoning: string } {
  const filter = makeQwenStreamFilter();
  return (delta: string) => filter.push(delta);
}

/** Length of the longest suffix of `text` that is a proper prefix of `tag`. */
function partialTagSuffix(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1);
  for (let len = max; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}
