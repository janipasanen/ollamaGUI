import { describe, it, expect } from 'vitest';
import {
  runToolCalls,
  toolCallName,
  type ToolCall,
  type ToolBatchOptions,
  type ToolExecution,
} from '../services/tools';

interface ToolResultLike {
  name: string;
  content: string;
  tool_call_id?: string;
}

function makeCalls(names: string[]): ToolCall[] {
  return names.map((name, index) => ({
    id: `id-${index}`,
    name,
    arguments: JSON.stringify({ i: index }),
  } as ToolCall));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run runToolCalls against a set of callbacks, collecting the gate/execute/
 * emit/post order and exposing the peak concurrency reached, so tests can
 * assert both ordering and true parallelism. Every `execute` is wrapped so the
 * harness tracks concurrent invocations regardless of what the test provides.
 */
function runHarness(opts: {
  toolCalls: ToolCall[];
  isSafe?: (tc: ToolCall) => boolean;
  signal?: AbortSignal;
  concurrency?: number;
  gate?: (tc: ToolCall) => Promise<ToolResultLike | null>;
  execute?: (tc: ToolCall) => Promise<ToolExecution>;
  postProcess?: (tc: ToolCall, r: ToolResultLike) => Promise<string>;
  emit?: (tc: ToolCall, r: ToolResultLike, storeContent: string) => Promise<void>;
}) {
  const state = {
    gates: [] as string[],
    executes: [] as string[],
    emits: [] as string[],
    stores: [] as string[],
    postOrder: [] as string[],
  };
  let active = 0;
  let peak = 0;
  let outRef: unknown[] = [];
  const controller = new AbortController();

  const baseExecute =
    opts.execute ??
    (async (tc: ToolCall) => ({
      result: { name: toolCallName(tc), content: `res:${toolCallName(tc)}` } as ToolResultLike,
      notify: true,
    }));

  const base: ToolBatchOptions = {
    signal: opts.signal ?? controller.signal,
    isSafe: opts.isSafe ?? (() => true),
    concurrency: opts.concurrency,
    gate:
      opts.gate ??
      (async (tc) => {
        state.gates.push(toolCallName(tc));
        return null;
      }),
    execute: async (tc) => {
      state.executes.push(toolCallName(tc));
      active++;
      peak = Math.max(peak, active);
      try {
        return await baseExecute(tc);
      } finally {
        active--;
      }
    },
    postProcess:
      opts.postProcess ??
      (async (tc, r) => {
        state.postOrder.push(toolCallName(tc));
        return r.content;
      }),
    emit:
      opts.emit ??
      (async (tc, r, storeContent) => {
        state.emits.push(toolCallName(tc));
        state.stores.push(storeContent);
        return { role: 'tool' as const, content: r.content, name: r.name, tool_call_id: 'x' };
      }),
  };
  return { state, peakNow: () => peak, controller, out: () => outRef, run: async () => { outRef = await runToolCalls(opts.toolCalls, base); return outRef; } };
}

describe('runToolCalls batch grouping (#587)', () => {
  it('executes a contiguous parallel-safe group concurrently, preserving order', async () => {
    const calls = makeCalls(['a', 'b', 'c', 'd']);
    const { state, peakNow, out, run } = runHarness({
      toolCalls: calls,
      execute: async (tc) => {
        await delay(15);
        return { result: { name: toolCallName(tc), content: `res:${toolCallName(tc)}` }, notify: true };
      },
    });
    await run();
    expect(peakNow()).toBeGreaterThanOrEqual(4); // ran truly concurrently
    expect(state.emits).toEqual(['a', 'b', 'c', 'd']); // original order
    // The messages returned to the caller are also in original call order.
    expect(out().map((m) => (m as { name: string }).name)).toEqual(['a', 'b', 'c', 'd']);
    expect(state.stores).toEqual(['res:a', 'res:b', 'res:c', 'res:d']);
    expect(state.postOrder).toEqual(['a', 'b', 'c', 'd']); // post-hooks ordered
  });

  it('honors the concurrency cap', async () => {
    const calls = makeCalls(['a', 'b', 'c', 'd', 'e', 'f']);
    const { peakNow, run } = runHarness({
      toolCalls: calls,
      concurrency: 2,
      execute: async (tc) => {
        await delay(10);
        return { result: { name: toolCallName(tc), content: 'x' }, notify: true };
      },
    });
    await run();
    expect(peakNow()).toBeLessThanOrEqual(2);
  });

  it('keeps mutating (non-parallelSafe) tools strictly sequential and in place', async () => {
    // safe_a, mut_b, safe_c, safe_d — only the trailing c/d form a group.
    const calls = makeCalls(['safe_a', 'mut_b', 'safe_c', 'safe_d']);
    const { state, peakNow, run } = runHarness({
      toolCalls: calls,
      isSafe: (tc) => !toolCallName(tc).startsWith('mut_'),
    });
    await run();
    // mut_b executed between the safe_a group and the safe_c/d group — i.e. one
    // at a time, in its place (the c/d group does run in parallel, peak 2).
    expect(peakNow()).toBe(2);
    expect(state.gates).toEqual(['safe_a', 'mut_b', 'safe_c', 'safe_d']);
    expect(state.executes).toEqual(['safe_a', 'mut_b', 'safe_c', 'safe_d']);
    expect(state.emits).toEqual(['safe_a', 'mut_b', 'safe_c', 'safe_d']);
  });

  it('never groups browser-style read-only tools (isSafe=false) together', async () => {
    const calls = makeCalls(['browser_snapshot', 'browser_screenshot']);
    const { peakNow, state, run } = runHarness({
      toolCalls: calls,
      isSafe: () => false,
    });
    await run();
    expect(peakNow()).toBe(1); // ran one at a time
    expect(state.emits).toEqual(['browser_snapshot', 'browser_screenshot']);
  });

  it('emits blocked results at their original position, interleaved with executed ones', async () => {
    const calls = makeCalls(['a', 'b']);
    const { state, run } = runHarness({
      toolCalls: calls,
      gate: async (tc) => (toolCallName(tc) === 'b' ? { name: 'b', content: 'blocked' } : null),
    });
    await run();
    expect(state.emits).toEqual(['a', 'b']);
    expect(state.stores).toEqual(['res:a', 'blocked']); // blocked content, no post-processing
  });

  it('does not post-process error results and does not notify on error', async () => {
    const calls = makeCalls(['a', 'b']);
    const { state, run } = runHarness({
      toolCalls: calls,
      execute: async (tc) => {
        if (toolCallName(tc) === 'b') {
          return { result: { name: 'b', content: 'boom' }, notify: false };
        }
        return { result: { name: 'a', content: 'ok' }, notify: true };
      },
      postProcess: async (tc) => `POST:${toolCallName(tc)}`,
    });
    await run();
    expect(state.stores).toEqual(['POST:a', 'boom']);
  });

  it('does not start a new group once the signal aborts (stops at a group boundary)', async () => {
    // Two parallel-safe groups of 2; abort as the first group finishes.
    const calls = makeCalls(['a', 'b', 'c', 'd']);
    const { state, run, controller } = runHarness({
      toolCalls: calls,
      concurrency: 2,
      execute: async (tc) => {
        if (toolCallName(tc) === 'b') {
          controller.abort(); // abort as the first group finishes
        }
        await delay(5);
        return { result: { name: toolCallName(tc), content: `res:${toolCallName(tc)}` }, notify: true };
      },
    });
    await run();
    // Second group (c, d) must not start after abort.
    expect(state.emits).toEqual(['a', 'b']);
    expect(state.gates).toEqual(['a', 'b']);
  });

  it('empty batch resolves without side effects', async () => {
    const { state, run } = runHarness({ toolCalls: [] });
    await run();
    expect(state.emits).toEqual([]);
  });
});
