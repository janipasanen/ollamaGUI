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
