/**
 * Agent activity log (#432).
 *
 * A tiny observable store of the agent's tool-call timeline for the current run.
 * App.tsx pushes a 'call' event on each tool invocation and a 'result' event on
 * each tool result (from the agenticChatStream onToolCall/onToolResult
 * callbacks). AgentActivityPanel subscribes and renders the timeline so the user
 * can see what the agent is doing right now.
 */

export interface AgentActivityEvent {
  id: number;
  kind: 'call' | 'result';
  tool: string;
  /** Args summary (for a call) or a short result preview (for a result). */
  detail?: string;
  ts: number;
}

let _seq = 0;
const _events: AgentActivityEvent[] = [];
const _listeners = new Set<() => void>();
const MAX_EVENTS = 300;

function emit(): void { _listeners.forEach((l) => l()); }

export function pushActivity(kind: 'call' | 'result', tool: string, detail?: string, ts = Date.now()): void {
  _events.push({ id: ++_seq, kind, tool: tool || '(tool)', detail: detail ? detail.slice(0, 400) : undefined, ts });
  if (_events.length > MAX_EVENTS) _events.splice(0, _events.length - MAX_EVENTS);
  emit();
}

export function listActivity(): AgentActivityEvent[] {
  return _events.slice();
}

export function clearActivity(): void {
  _events.length = 0;
  emit();
}

export function subscribeActivity(cb: () => void): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

/** Test seam: reset the store between tests. */
export function _resetActivity(): void {
  _events.length = 0;
  _seq = 0;
  _listeners.clear();
}
