import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerHook, removeHook, clearHooks, listHookIds,
  runPreToolUseHooks,
  makeDenyListHook, makeAllowListHook, makeReadOnlyHook,
} from '../services/toolHooks';
import { toolRegistry } from '../services/tools';
import { setReadOnlyMode } from '../services/agentAutonomy';

beforeEach(() => {
  clearHooks();
  setReadOnlyMode(false);
  localStorage.clear();
});

afterEach(() => {
  clearHooks();
  setReadOnlyMode(false);
});

describe('hook registration (#90)', () => {
  it('registerHook adds a hook by id', () => {
    registerHook('h1', () => ({ action: 'allow' }));
    expect(listHookIds()).toContain('h1');
  });

  it('removeHook removes the hook', () => {
    registerHook('h1', () => ({ action: 'allow' }));
    removeHook('h1');
    expect(listHookIds()).not.toContain('h1');
  });

  it('clearHooks removes all hooks', () => {
    registerHook('h1', () => ({ action: 'allow' }));
    registerHook('h2', () => ({ action: 'allow' }));
    clearHooks();
    expect(listHookIds()).toHaveLength(0);
  });
});

describe('runPreToolUseHooks (#90)', () => {
  it('allows when no hooks registered', async () => {
    const result = await runPreToolUseHooks('read_file', { path: 'f.ts' });
    expect(result.allowed).toBe(true);
  });

  it('allow hook passes through unchanged', async () => {
    registerHook('h', () => ({ action: 'allow' }));
    const result = await runPreToolUseHooks('t', { x: 1 });
    expect(result.allowed).toBe(true);
    expect(result.args).toEqual({ x: 1 });
  });

  it('block hook stops the call', async () => {
    registerHook('guard', () => ({ action: 'block', reason: 'denied' }));
    const result = await runPreToolUseHooks('t', {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('denied');
  });

  it('transform hook replaces args', async () => {
    registerHook('transformer', (_name, args) => ({
      action: 'transform',
      args: { ...args, injected: true },
    }));
    const result = await runPreToolUseHooks('t', { original: 1 });
    expect(result.allowed).toBe(true);
    expect(result.args).toEqual({ original: 1, injected: true });
  });

  it('transform chains: second hook sees transformed args', async () => {
    registerHook('t1', (_n, args) => ({ action: 'transform', args: { ...args, a: 1 } }));
    registerHook('t2', (_n, args) => ({ action: 'transform', args: { ...args, b: 2 } }));
    const result = await runPreToolUseHooks('t', {});
    expect(result.args).toEqual({ a: 1, b: 2 });
  });

  it('block short-circuits remaining hooks', async () => {
    let secondRan = false;
    registerHook('blocker', () => ({ action: 'block' }));
    registerHook('second', () => { secondRan = true; return { action: 'allow' }; });
    await runPreToolUseHooks('t', {});
    expect(secondRan).toBe(false);
  });

  it('supports async hooks', async () => {
    registerHook('async-hook', async () => {
      return { action: 'block', reason: 'async block' };
    });
    const result = await runPreToolUseHooks('t', {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('async block');
  });
});

describe('makeDenyListHook (#90)', () => {
  it('blocks listed tools', async () => {
    registerHook('dl', makeDenyListHook(['write_file', 'apply_edit']));
    const r1 = await runPreToolUseHooks('write_file', {});
    expect(r1.allowed).toBe(false);
    const r2 = await runPreToolUseHooks('read_file', {});
    expect(r2.allowed).toBe(true);
  });
});

describe('makeAllowListHook (#90)', () => {
  it('blocks tools NOT in the list', async () => {
    registerHook('al', makeAllowListHook(['read_file', 'list_dir']));
    const r1 = await runPreToolUseHooks('write_file', {});
    expect(r1.allowed).toBe(false);
    const r2 = await runPreToolUseHooks('read_file', {});
    expect(r2.allowed).toBe(true);
  });
});

describe('makeReadOnlyHook (#146)', () => {
  beforeEach(() => {
    // Register a writable and a read-only tool for testing
    toolRegistry.registerTool({
      name: '__test_writer',
      description: 'writes',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({}),
      readOnly: false,
    });
    toolRegistry.registerTool({
      name: '__test_reader',
      description: 'reads',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({}),
      readOnly: true,
    });
  });

  afterEach(() => {
    toolRegistry.unregisterTool('__test_writer');
    toolRegistry.unregisterTool('__test_reader');
  });

  it('allows any tool when readOnly mode is off', async () => {
    setReadOnlyMode(false);
    registerHook('ro', makeReadOnlyHook());
    expect((await runPreToolUseHooks('__test_writer', {})).allowed).toBe(true);
    expect((await runPreToolUseHooks('__test_reader', {})).allowed).toBe(true);
  });

  it('blocks mutating tool when readOnly mode is on', async () => {
    setReadOnlyMode(true);
    registerHook('ro', makeReadOnlyHook());
    const r = await runPreToolUseHooks('__test_writer', {});
    expect(r.allowed).toBe(false);
  });

  it('allows readOnly tool even in readOnly mode', async () => {
    setReadOnlyMode(true);
    registerHook('ro', makeReadOnlyHook());
    const r = await runPreToolUseHooks('__test_reader', {});
    expect(r.allowed).toBe(true);
  });
});
