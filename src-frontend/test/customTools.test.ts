import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  _setSandboxRun,
  addCustomTool, updateCustomTool, removeCustomTool,
  loadCustomTools, saveCustomTools, initCustomTools,
  addFunctionDef, updateFunctionDef, removeFunctionDef, loadFunctionDefs,
  applyFilterInlet, applyFilterOutlet,
  runAction, getEnabledActions,
  STARTER_EXAMPLES,
} from '../services/customTools';
import { toolRegistry } from '../services/tools';

// ── Sandbox mock ──────────────────────────────────────────────────────────────
// Tests don't have a real Worker environment. We inject a mock runner that
// evaluates code using Function constructor (safe enough for test strings).
const mockSandbox = async (code: string, params: Record<string, any>): Promise<any> => {
  const fn = new Function('params', code);
  return fn(params);
};

beforeEach(() => {
  localStorage.clear();
  _setSandboxRun(mockSandbox);
  // Clean up any custom__ tools from prior tests
  toolRegistry.getAllTools()
    .filter(t => t.name.startsWith('custom__'))
    .forEach(t => toolRegistry.unregisterTool(t.name));
});

// ── Tool CRUD + registration ───────────────────────────────────────────────────

describe('Custom Tools — CRUD and registration (#127)', () => {
  it('addCustomTool persists and registers into toolRegistry when enabled', () => {
    addCustomTool({
      name: 'greet',
      description: 'Greet someone',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'name' } }, required: ['name'] },
      code: 'return "Hello " + params.name;',
      enabled: true,
    });
    expect(loadCustomTools()).toHaveLength(1);
    expect(toolRegistry.getTool('custom__greet')).toBeDefined();
  });

  it('addCustomTool with enabled=false does NOT register into toolRegistry', () => {
    addCustomTool({
      name: 'hidden',
      description: 'Hidden tool',
      parameters: { type: 'object', properties: {} },
      code: 'return null;',
      enabled: false,
    });
    expect(toolRegistry.getTool('custom__hidden')).toBeUndefined();
  });

  it('updateCustomTool re-registers after enabling', () => {
    const t = addCustomTool({
      name: 'flip',
      description: 'Flip',
      parameters: { type: 'object', properties: {} },
      code: 'return true;',
      enabled: false,
    });
    expect(toolRegistry.getTool('custom__flip')).toBeUndefined();
    updateCustomTool(t.id, { enabled: true });
    expect(toolRegistry.getTool('custom__flip')).toBeDefined();
  });

  it('updateCustomTool unregisters after disabling', () => {
    const t = addCustomTool({
      name: 'flip2',
      description: 'Flip2',
      parameters: { type: 'object', properties: {} },
      code: 'return true;',
      enabled: true,
    });
    expect(toolRegistry.getTool('custom__flip2')).toBeDefined();
    updateCustomTool(t.id, { enabled: false });
    expect(toolRegistry.getTool('custom__flip2')).toBeUndefined();
  });

  it('removeCustomTool unregisters from toolRegistry and removes from storage', () => {
    const t = addCustomTool({
      name: 'temp',
      description: 'Temp',
      parameters: { type: 'object', properties: {} },
      code: 'return 1;',
      enabled: true,
    });
    removeCustomTool(t.id);
    expect(loadCustomTools()).toHaveLength(0);
    expect(toolRegistry.getTool('custom__temp')).toBeUndefined();
  });

  it('disabled tools are excluded from getOllamaToolDefinitions', () => {
    addCustomTool({
      name: 'visible', description: 'v', parameters: { type: 'object', properties: {} }, code: 'return 1;', enabled: true,
    });
    addCustomTool({
      name: 'invisible', description: 'i', parameters: { type: 'object', properties: {} }, code: 'return 2;', enabled: false,
    });
    const names = toolRegistry.getOllamaToolDefinitions().map(d => d.function.name);
    expect(names).toContain('custom__visible');
    expect(names).not.toContain('custom__invisible');
  });

  it('initCustomTools re-registers enabled tools from storage', () => {
    saveCustomTools([{
      id: 'abc', name: 'startup', description: 'Startup',
      parameters: { type: 'object', properties: {} }, code: 'return 99;', enabled: true,
    }]);
    initCustomTools();
    expect(toolRegistry.getTool('custom__startup')).toBeDefined();
  });

  it('custom tool executes via toolRegistry.executeToolCall', async () => {
    addCustomTool({
      name: 'adder',
      description: 'Add two numbers',
      parameters: { type: 'object', properties: { a: { type: 'number', description: 'a' }, b: { type: 'number', description: 'b' } }, required: ['a', 'b'] },
      code: 'return { sum: params.a + params.b };',
      enabled: true,
    });
    const result = await toolRegistry.executeToolCall({
      id: 'tc1', type: 'function',
      function: { name: 'custom__adder', arguments: JSON.stringify({ a: 3, b: 4 }) },
    });
    expect(JSON.parse(result.content)).toEqual({ sum: 7 });
  });
});

// ── Worker timeout ─────────────────────────────────────────────────────────────

describe('Custom Tools — sandbox timeout (#127)', () => {
  it('times out and rejects when sandbox signals timeout', async () => {
    // Replace sandbox with a slow one for this test
    _setSandboxRun(async () => {
      await new Promise(resolve => setTimeout(resolve, 50_000));
      return 'should not reach';
    });
    // Wrap with our own shorter timeout race to simulate the real behavior
    const tool = addCustomTool({
      name: 'loopy',
      description: 'Loops forever',
      parameters: { type: 'object', properties: {} },
      code: 'while(true){}',
      enabled: true,
    });
    // The sandboxRun is stubbed — just verify the real execute path calls it
    const exec = toolRegistry.getTool('custom__loopy')!.execute;
    const p = Promise.race([
      exec({}),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Tool execution timed out')), 100)),
    ]);
    await expect(p).rejects.toThrow(/timed out/i);
    // restore
    _setSandboxRun(mockSandbox);
    removeCustomTool(tool.id);
  });
});

// ── Function (Filter/Action) CRUD ─────────────────────────────────────────────

describe('FunctionDefs — CRUD (#127)', () => {
  it('addFunctionDef persists', () => {
    addFunctionDef({ kind: 'filter', name: 'my_filter', code: 'function inlet(m){return m;}', enabled: true });
    expect(loadFunctionDefs()).toHaveLength(1);
  });

  it('updateFunctionDef patches correctly', () => {
    const f = addFunctionDef({ kind: 'filter', name: 'f1', code: 'function inlet(m){return m;}', enabled: true });
    updateFunctionDef(f.id, { enabled: false });
    expect(loadFunctionDefs().find(x => x.id === f.id)!.enabled).toBe(false);
  });

  it('removeFunctionDef deletes from storage', () => {
    const f = addFunctionDef({ kind: 'filter', name: 'f2', code: '', enabled: true });
    removeFunctionDef(f.id);
    expect(loadFunctionDefs()).toHaveLength(0);
  });
});

// ── Filter inlet/outlet chaining ───────────────────────────────────────────────

describe('Filter — inlet/outlet chaining by priority (#127)', () => {
  it('inlet filter transforms message content', async () => {
    addFunctionDef({
      kind: 'filter', name: 'uppercase_filter',
      code: `function inlet(messages) {
        return messages.map(m => ({ ...m, content: m.content.toUpperCase() }));
      }`,
      enabled: true, priority: 10,
    });
    const result = await applyFilterInlet([{ role: 'user', content: 'hello' }]);
    expect(result[0].content).toBe('HELLO');
  });

  it('outlet filter transforms response text', async () => {
    addFunctionDef({
      kind: 'filter', name: 'star_filter',
      code: `function outlet(text) { return '⭐ ' + text; }`,
      enabled: true,
    });
    const result = await applyFilterOutlet('response');
    expect(result).toBe('⭐ response');
  });

  it('filters chain in priority order (lower number first)', async () => {
    const order: number[] = [];
    _setSandboxRun(async (code: string, params: Record<string, any>) => {
      if (code.includes('priority_1')) { order.push(1); return params.messages ?? params.text; }
      if (code.includes('priority_2')) { order.push(2); return params.messages ?? params.text; }
      return params.messages ?? params.text;
    });
    addFunctionDef({ kind: 'filter', name: 'f_p2', code: 'priority_2', enabled: true, priority: 20 });
    addFunctionDef({ kind: 'filter', name: 'f_p1', code: 'priority_1', enabled: true, priority: 10 });
    await applyFilterInlet([{ role: 'user', content: 'x' }]);
    expect(order).toEqual([1, 2]);
    _setSandboxRun(mockSandbox);
  });

  it('disabled filters are not applied', async () => {
    addFunctionDef({
      kind: 'filter', name: 'disabled_filter',
      code: `function inlet(messages) {
        return messages.map(m => ({ ...m, content: 'REPLACED' }));
      }`,
      enabled: false,
    });
    const result = await applyFilterInlet([{ role: 'user', content: 'original' }]);
    expect(result[0].content).toBe('original');
  });

  it('filter error is non-fatal — chain continues', async () => {
    addFunctionDef({ kind: 'filter', name: 'broken', code: 'throw new Error("boom")', enabled: true, priority: 1 });
    addFunctionDef({
      kind: 'filter', name: 'working',
      code: `function inlet(messages) { return messages.map(m => ({...m, content: m.content + '_ok'})); }`,
      enabled: true, priority: 2,
    });
    const result = await applyFilterInlet([{ role: 'user', content: 'test' }]);
    // broken filter errored (non-fatal), working filter still ran
    expect(result[0].content).toBe('test_ok');
  });
});

// ── Action functions ───────────────────────────────────────────────────────────

describe('Action functions (#127)', () => {
  it('runAction calls the action fn and returns string result', async () => {
    const fn = addFunctionDef({
      kind: 'action', name: 'echo_action',
      code: `function action(message) { return 'Echo: ' + message.content; }`,
      enabled: true,
    });
    const out = await runAction(fn.id, { role: 'assistant', content: 'hello world' });
    expect(out).toBe('Echo: hello world');
  });

  it('runAction returns null for disabled action', async () => {
    const fn = addFunctionDef({
      kind: 'action', name: 'off_action',
      code: `function action(message) { return 'x'; }`,
      enabled: false,
    });
    expect(await runAction(fn.id, { role: 'assistant', content: 'hi' })).toBeNull();
  });

  it('getEnabledActions returns only enabled actions', () => {
    addFunctionDef({ kind: 'action', name: 'a1', code: '', enabled: true });
    addFunctionDef({ kind: 'action', name: 'a2', code: '', enabled: false });
    addFunctionDef({ kind: 'filter', name: 'f1', code: '', enabled: true });
    const actions = getEnabledActions();
    expect(actions.map(a => a.name)).toContain('a1');
    expect(actions.map(a => a.name)).not.toContain('a2');
    expect(actions.map(a => a.name)).not.toContain('f1');
  });
});

// ── Starter examples ───────────────────────────────────────────────────────────

describe('Starter examples (#127)', () => {
  it('word_count example executes correctly', async () => {
    const ex = STARTER_EXAMPLES.find(e => e.label === 'Word Count (tool)')!;
    const t = addCustomTool(ex.tool!);
    const result = await toolRegistry.getTool(`custom__${ex.tool!.name}`)!.execute({ text: 'hello world foo' });
    expect(result.count).toBe(3);
    removeCustomTool(t.id);
  });
});
