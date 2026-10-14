// @vitest-environment node
/**
 * Agent roles (#630): which model plays which part, and how a delegated role is run.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadRoleModels, saveRoleModels, organizerEnabled, toolsForRole, ROLE_TOOLS, ROLE_PROMPTS,
  ROLES, DELEGATE_ROLES, ROLES_STORAGE_KEY,
} from '../services/roles';
import { runRole, type RunRoleDeps } from '../services/roleAgents';
import { agenticChatStream } from '../services/agent';

class Mem {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
}
beforeEach(() => { (globalThis as any).localStorage = new Mem(); });

describe('role model assignments', () => {
  it('start empty, so roles are opt-in', () => {
    expect(loadRoleModels()).toEqual({});
    expect(organizerEnabled()).toBe(false);
  });

  it('round-trip, dropping blanks and unknown roles', () => {
    saveRoleModels({ organizer: 'cloud-model:cloud', developer: 'conn1/qwen', reviewer: '  ' } as any);
    expect(loadRoleModels()).toEqual({ organizer: 'cloud-model:cloud', developer: 'conn1/qwen' });
    localStorage.setItem(ROLES_STORAGE_KEY, JSON.stringify({ writer: 'w', janitor: 'x', developer: 5 }));
    expect(loadRoleModels()).toEqual({ writer: 'w' });
  });

  it('survive corrupt storage', () => {
    localStorage.setItem(ROLES_STORAGE_KEY, '{not json');
    expect(loadRoleModels()).toEqual({});
    localStorage.setItem(ROLES_STORAGE_KEY, '[1,2]');
    expect(loadRoleModels()).toEqual({});
  });

  it('enable orchestration only when an organizer is set', () => {
    expect(organizerEnabled({ developer: 'a' })).toBe(false);
    expect(organizerEnabled({ organizer: 'a' })).toBe(true);
  });
});

describe('role tool scoping is the real boundary', () => {
  it('the organizer can read, plan and delegate but never write or run shell', () => {
    const t = ROLE_TOOLS.organizer;
    expect(t).toContain('delegate_to_role');
    expect(t).toContain('update_plan');
    for (const bad of ['write_file', 'apply_edit', 'apply_patch', 'run_shell_command']) expect(t).not.toContain(bad);
  });

  it('the reviewer cannot modify anything', () => {
    for (const bad of ['write_file', 'apply_edit', 'apply_patch', 'run_shell_command']) {
      expect(ROLE_TOOLS.reviewer).not.toContain(bad);
    }
  });

  it('no delegate role can delegate further, so recursion is impossible', () => {
    for (const r of DELEGATE_ROLES) expect(ROLE_TOOLS[r]).not.toContain('delegate_to_role');
  });

  it('only registered tools are offered', () => {
    expect(toolsForRole('developer', ['read_file', 'write_file'])).toEqual(['read_file', 'write_file']);
  });

  it('every role has a prompt', () => {
    for (const r of ROLES) expect(ROLE_PROMPTS[r].length).toBeGreaterThan(20);
  });
});

function deps(over: Partial<RunRoleDeps> = {}) {
  const seen: any[] = [];
  const mk = (kind: string, text = 'done') => (opts: any) => (async function* () {
    seen.push({ kind, opts });
    opts.onAssistantMessage?.(text);
    yield { role: 'assistant', content: text } as any;
  })();
  const d: RunRoleDeps = {
    roleModels: {},
    selectedModel: 'selected',
    resolveRouting: id => id.startsWith('lm/')
      ? { model: id.slice(3), endpoint: '', conn: { id: 'lm', name: 'LM', kind: 'openai', baseUrl: 'http://lm', enabled: true } }
      : { model: id, endpoint: 'http://ollama/api/chat', apiKey: id.endsWith('cloud') ? 'key' : undefined },
    availableTools: ['read_file', 'write_file', 'run_tests', 'delegate_to_role'],
    runOllama: mk('ollama'),
    runOpenAi: mk('openai'),
    ...over,
  };
  return { d, seen };
}

describe('runRole', () => {
  it('uses the role\'s own model, on its own server', async () => {
    const { d, seen } = deps({ roleModels: { developer: 'lm/qwen3-coder', reviewer: 'gpt-oss:120b-cloud' } });
    const dev = await runRole('developer', 'build it', d);
    expect(dev.model).toBe('lm/qwen3-coder');
    expect(seen[0].kind).toBe('openai');
    expect(seen[0].opts.model).toBe('qwen3-coder');
    const rev = await runRole('reviewer', 'check it', d);
    expect(seen[1].kind).toBe('ollama');
    // Ollama Cloud used directly must authenticate.
    expect(seen[1].opts.apiKey).toBe('key');
  });

  it('falls back to the selected model for an unset role', async () => {
    const { d, seen } = deps();
    await runRole('writer', 'doc it', d);
    expect(seen[0].opts.model).toBe('selected');
  });

  it('gives the role its prompt and scoped tools, without delegate_to_role', async () => {
    const { d, seen } = deps();
    await runRole('reviewer', 'check', d);
    expect(seen[0].opts.messages[0].content).toBe(ROLE_PROMPTS.reviewer);
    expect(seen[0].opts.messages[1]).toEqual({ role: 'user', content: 'check' });
    expect(seen[0].opts.toolFilter).toEqual(['read_file', 'run_tests']);
  });

  it('rejects the organizer and unknown roles as delegates', async () => {
    const { d, seen } = deps();
    expect((await runRole('organizer', 'x', d)).error).toMatch(/non-delegable/);
    expect((await runRole('janitor' as any, 'x', d)).error).toBeTruthy();
    expect(seen).toHaveLength(0);
  });

  it('rejects an empty task', async () => {
    const { d } = deps();
    expect((await runRole('developer', '   ', d)).error).toMatch(/Empty task/);
  });

  it('reports a failing role instead of returning silence', async () => {
    const { d } = deps({
      runOllama: (opts: any) => (async function* () { opts.onError(new Error('connection refused')); })(),
    });
    const r = await runRole('developer', 'x', d);
    expect(r.error).toBe('connection refused');
  });

  it('reports a role that produced nothing', async () => {
    const { d } = deps({ runOllama: () => (async function* () { /* nothing */ })() });
    expect((await runRole('developer', 'x', d)).error).toMatch(/no output/);
  });

  it('turns a thrown stream into an error result', async () => {
    const { d } = deps({ runOllama: () => (async function* () { throw new Error('boom'); })() });
    expect((await runRole('developer', 'x', d)).error).toBe('boom');
  });
});

describe('agent loop authenticates to Ollama Cloud', () => {
  it('sends a bearer token only when a key is given', async () => {
    const calls: any[] = [];
    (globalThis as any).fetch = vi.fn(async (_u: string, init: any) => {
      calls.push(init.headers);
      return { ok: false, status: 401, text: async () => 'no', json: async () => ({}) };
    });
    for (const apiKey of ['sk-1', undefined]) {
      const g = agenticChatStream({ model: 'm', messages: [{ role: 'user', content: 'x' }], endpoint: 'https://ollama.com/api/chat', apiKey, onError: () => {} });
      for await (const _ of g) { /* drain */ }
    }
    expect(calls[0].Authorization).toBe('Bearer sk-1');
    expect(calls[1].Authorization).toBeUndefined();
  });
});
