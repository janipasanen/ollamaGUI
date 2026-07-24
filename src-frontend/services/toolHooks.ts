/**
 * PreToolUse hook system (#90, #146).
 *
 * Hooks run before every tool call. Each hook returns:
 *   allow     — let the call proceed (possibly with transformed args).
 *   block     — deny the call with an optional reason.
 *   transform — allow the call but replace the args with `result.args`.
 *
 * Built-in factory hooks:
 *   makeDenyListHook(names[])  — blocks specific tool names.
 *   makeAllowListHook(names[]) — blocks everything NOT in the list.
 *   makeReadOnlyHook()         — blocks any tool not marked readOnly when
 *                                readOnly mode is active.
 */

import { isReadOnlyMode } from './agentAutonomy';
import { toolRegistry } from './tools';

export type HookAction = 'allow' | 'block' | 'transform';

export interface HookResult {
  action: HookAction;
  /** For 'transform': the new args to pass to the tool. */
  args?: Record<string, unknown>;
  /** Human-readable reason (shown in UI on block). */
  reason?: string;
}

export type PreToolUseHook = (
  toolName: string,
  args: Record<string, unknown>,
) => HookResult | Promise<HookResult>;

/** The running chain of registered hooks (ordered by insertion). */
const _hooks: Map<string, PreToolUseHook> = new Map();

export function registerHook(id: string, hook: PreToolUseHook): void {
  _hooks.set(id, hook);
}

export function removeHook(id: string): void {
  _hooks.delete(id);
}

export function clearHooks(): void {
  _hooks.clear();
}

export function listHookIds(): string[] {
  return Array.from(_hooks.keys());
}

/**
 * Run all registered hooks for a pending tool call.
 *
 * Returns the final effective args (possibly transformed) or throws if
 * a hook blocks the call.
 *
 * Hooks are evaluated in insertion order. The first `block` short-circuits
 * the chain. Transforms are chained (output args become the input to the
 * next hook).
 */
export async function runPreToolUseHooks(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ allowed: boolean; args: Record<string, unknown>; reason?: string }> {
  let currentArgs = { ...args };
  for (const hook of _hooks.values()) {
    const result = await hook(toolName, currentArgs);
    if (result.action === 'block') {
      return { allowed: false, args: currentArgs, reason: result.reason };
    }
    if (result.action === 'transform' && result.args) {
      currentArgs = result.args;
    }
  }
  return { allowed: true, args: currentArgs };
}

// ── Built-in hook factories ───────────────────────────────────────────────────

/** Blocks tool calls whose name is in `names`. */
export function makeDenyListHook(names: string[]): PreToolUseHook {
  const set = new Set(names);
  return (toolName) =>
    set.has(toolName)
      ? { action: 'block', reason: `Tool '${toolName}' is on the deny list.` }
      : { action: 'allow' };
}

/** Blocks tool calls whose name is NOT in `names`. */
export function makeAllowListHook(names: string[]): PreToolUseHook {
  const set = new Set(names);
  return (toolName) =>
    set.has(toolName)
      ? { action: 'allow' }
      : { action: 'block', reason: `Tool '${toolName}' is not on the allow list.` };
}

/**
 * Blocks mutating tools when readOnly mode is active.
 * A tool is considered read-only if its `ToolDefinition.readOnly` flag is true.
 */
export function makeReadOnlyHook(): PreToolUseHook {
  return (toolName) => {
    if (!isReadOnlyMode()) return { action: 'allow' };
    const tool = toolRegistry.getTool(toolName);
    const toolIsReadOnly = tool?.readOnly ?? false;
    if (!toolIsReadOnly) {
      return {
        action: 'block',
        reason: `Tool '${toolName}' is blocked: readOnly mode is active and the tool is not marked as read-only.`,
      };
    }
    return { action: 'allow' };
  };
}

// ── PostToolUse hook system (#395, Claude Code parity) ───────────────────────
//
// PostToolUse hooks run AFTER a tool has executed, receiving the tool name,
// the effective args, and the produced ToolResult content. Each hook returns:
//   allow     — pass the result through (optionally transformed).
//   block     — replace the result content with `reason` (e.g. redact secrets,
//              audit-log a denial). The tool already ran; "block" here means
//              "do not feed this output to the model".
//   transform — allow but replace the result content with `result.content`.

export interface PostToolUseHookResult {
  action: HookAction;
  /** For 'transform': the new result content fed to the model. */
  content?: string;
  /** Human-readable reason (shown in UI / replaces content on block). */
  reason?: string;
}

export type PostToolUseHook = (
  toolName: string,
  args: Record<string, unknown>,
  resultContent: string,
) => PostToolUseHookResult | Promise<PostToolUseHookResult>;

const _postHooks: Map<string, PostToolUseHook> = new Map();

export function registerPostToolUseHook(id: string, hook: PostToolUseHook): void {
  _postHooks.set(id, hook);
}

export function removePostToolUseHook(id: string): void {
  _postHooks.delete(id);
}

export function clearPostToolUseHooks(): void {
  _postHooks.clear();
}

export function listPostToolUseHookIds(): string[] {
  return Array.from(_postHooks.keys());
}

/**
 * Run all registered PostToolUse hooks for a completed tool call.
 *
 * Returns the final effective result content (possibly replaced). Hooks run in
 * insertion order; the first `block` short-circuits and returns its reason.
 * A `transform` replaces the content for subsequent hooks.
 */
export async function runPostToolUseHooks(
  toolName: string,
  args: Record<string, unknown>,
  resultContent: string,
): Promise<{ content: string; blocked: boolean; reason?: string }> {
  let content = resultContent;
  for (const hook of _postHooks.values()) {
    const res = await hook(toolName, args, content);
    if (res.action === 'block') {
      const reason = res.reason ?? `Tool '${toolName}' result blocked by post-hook.`;
      return { content: reason, blocked: true, reason };
    }
    if (res.action === 'transform' && typeof res.content === 'string') {
      content = res.content;
    }
  }
  return { content, blocked: false };
}

// ── Built-in PostToolUse hook factories ──────────────────────────────────────

/**
 * Redact occurrences of `secret` from tool output before it reaches the model.
 * Useful to avoid leaking tokens/keys into the prompt context.
 */
export function makeRedactHook(secret: string): PostToolUseHook {
  return (_toolName, _args, content) => {
    if (!secret || !content.includes(secret)) return { action: 'allow' };
    return { action: 'transform', content: content.split(secret).join('[REDACTED]') };
  };
}

/**
 * Redact any of a dynamic set of secrets from tool output before it reaches the
 * model. `getSecrets` is invoked on every tool result, so secrets added at
 * runtime (e.g. newly-configured connection API keys) are covered without
 * re-registering the hook. Secrets shorter than 6 chars are ignored to avoid
 * accidental over-redaction of common substrings (#409).
 */
export function makeSecretsRedactHook(getSecrets: () => string[]): PostToolUseHook {
  return (_toolName, _args, content) => {
    let out = content;
    for (const s of getSecrets()) {
      if (s && s.length >= 6 && out.includes(s)) out = out.split(s).join('[REDACTED]');
    }
    return out === content ? { action: 'allow' } : { action: 'transform', content: out };
  };
}
