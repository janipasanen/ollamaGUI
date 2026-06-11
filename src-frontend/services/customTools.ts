/**
 * User-defined Tools & Functions framework (#127).
 *
 * Tools:  JS code snippets that register into toolRegistry as callable functions.
 * Filters: transform message lists (inlet) or response text (outlet), chained by priority.
 * Actions: add per-message buttons to the assistant message toolbar.
 *
 * All user code runs in a Web Worker sandbox with a capped timeout so a
 * runaway body can't hang the UI. The `eval` pattern in the built-in
 * `calculate` tool is also replaced with the sandboxed runner.
 */
import { toolRegistry, type ToolDefinition } from './tools';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CustomTool {
  id: string;
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  /** JS function body. `params` is the argument object. Must return/resolve a value. */
  code: string;
  enabled: boolean;
}

export interface FunctionDef {
  id: string;
  kind: 'filter' | 'action';
  name: string;
  description?: string;
  /**
   * Filter: export functions inlet(messages) and/or outlet(text).
   * Action: export function action(message) — may return a string to inject as a new message.
   */
  code: string;
  enabled: boolean;
  /** Lower number = runs first (for filters). Default 100. */
  priority?: number;
}

const TOOLS_KEY = 'custom_tools';
const FUNCTIONS_KEY = 'custom_functions';
const DEFAULT_TIMEOUT_MS = 5_000;

// ── Sandbox ───────────────────────────────────────────────────────────────────

/**
 * Seam for tests: override to avoid real Worker construction in jsdom.
 * Signature: (code, params, timeoutMs) => Promise<any>
 */
export let _sandboxRun: (code: string, params: Record<string, any>, timeoutMs?: number) => Promise<any> = realSandboxRun;

export function _setSandboxRun(fn: typeof _sandboxRun): void {
  _sandboxRun = fn;
}

/** Worker script that executes user code. Created once as a blob URL. */
let _workerBlobUrl: string | null = null;
function getWorkerBlobUrl(): string {
  if (_workerBlobUrl) return _workerBlobUrl;
  const script = `
self.onmessage = async function(e) {
  var id = e.data.id;
  try {
    var fn = new Function('params', e.data.code);
    var result = await fn(e.data.params);
    self.postMessage({ id: id, result: result });
  } catch (err) {
    self.postMessage({ id: id, error: String(err && err.message ? err.message : err) });
  }
};`;
  const blob = new Blob([script], { type: 'application/javascript' });
  _workerBlobUrl = URL.createObjectURL(blob);
  return _workerBlobUrl;
}

async function realSandboxRun(
  code: string,
  params: Record<string, any>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<any> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(getWorkerBlobUrl());
    } catch {
      // Worker not available (SSR / test env fallback) — refuse rather than eval
      reject(new Error('Sandbox unavailable'));
      return;
    }

    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Tool execution timed out'));
    }, timeoutMs);

    worker.onmessage = (e) => {
      if (e.data.id !== id) return;
      clearTimeout(timer);
      worker.terminate();
      if ('error' in e.data) reject(new Error(e.data.error));
      else resolve(e.data.result);
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(e.message ?? 'Worker error'));
    };

    worker.postMessage({ id, code, params });
  });
}

// ── Tool CRUD + registration ──────────────────────────────────────────────────

export function loadCustomTools(): CustomTool[] {
  try { return JSON.parse(localStorage.getItem(TOOLS_KEY) ?? '[]'); } catch { return []; }
}

export function saveCustomTools(tools: CustomTool[]): void {
  localStorage.setItem(TOOLS_KEY, JSON.stringify(tools));
}

export function addCustomTool(tool: Omit<CustomTool, 'id'>): CustomTool {
  const entry: CustomTool = { ...tool, id: crypto.randomUUID() };
  const all = loadCustomTools();
  all.push(entry);
  saveCustomTools(all);
  if (entry.enabled) _registerTool(entry);
  return entry;
}

export function updateCustomTool(id: string, patch: Partial<Omit<CustomTool, 'id'>>): void {
  const all = loadCustomTools().map(t => t.id === id ? { ...t, ...patch } : t);
  saveCustomTools(all);
  const updated = all.find(t => t.id === id);
  if (!updated) return;
  toolRegistry.unregisterTool(toolNameFor(updated));
  if (updated.enabled) _registerTool(updated);
}

export function removeCustomTool(id: string): void {
  const all = loadCustomTools();
  const t = all.find(x => x.id === id);
  if (t) toolRegistry.unregisterTool(toolNameFor(t));
  saveCustomTools(all.filter(x => x.id !== id));
}

function toolNameFor(t: CustomTool): string {
  return `custom__${t.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function _registerTool(t: CustomTool): void {
  const def: ToolDefinition = {
    name: toolNameFor(t),
    description: t.description,
    parameters: t.parameters as any,
    execute: (params) => _sandboxRun(t.code, params),
  };
  toolRegistry.registerTool(def);
}

/** Re-register all enabled tools (call on startup). */
export function initCustomTools(): void {
  for (const t of loadCustomTools()) {
    toolRegistry.unregisterTool(toolNameFor(t));
    if (t.enabled) _registerTool(t);
  }
}

// ── Function (Filter / Action) CRUD ──────────────────────────────────────────

export function loadFunctionDefs(): FunctionDef[] {
  try { return JSON.parse(localStorage.getItem(FUNCTIONS_KEY) ?? '[]'); } catch { return []; }
}

export function saveFunctionDefs(fns: FunctionDef[]): void {
  localStorage.setItem(FUNCTIONS_KEY, JSON.stringify(fns));
}

export function addFunctionDef(fn: Omit<FunctionDef, 'id'>): FunctionDef {
  const entry: FunctionDef = { ...fn, id: crypto.randomUUID() };
  const all = loadFunctionDefs();
  all.push(entry);
  saveFunctionDefs(all);
  return entry;
}

export function updateFunctionDef(id: string, patch: Partial<Omit<FunctionDef, 'id'>>): void {
  saveFunctionDefs(loadFunctionDefs().map(f => f.id === id ? { ...f, ...patch } : f));
}

export function removeFunctionDef(id: string): void {
  saveFunctionDefs(loadFunctionDefs().filter(f => f.id !== id));
}

// ── Filter engine ─────────────────────────────────────────────────────────────

type Message = { role: string; content: string; [k: string]: any };

/**
 * Run enabled filters' inlet(messages) in priority order.
 * Returns the (possibly mutated) messages array.
 */
export async function applyFilterInlet(messages: Message[]): Promise<Message[]> {
  const filters = loadFunctionDefs()
    .filter(f => f.kind === 'filter' && f.enabled)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  let result = messages;
  for (const f of filters) {
    try {
      // Wrap code so user just writes `inlet(messages)` or exports it
      const wrapCode = `
        ${f.code}
        if (typeof inlet === 'function') return inlet(params.messages);
        return params.messages;
      `;
      const out = await _sandboxRun(wrapCode, { messages: result });
      if (Array.isArray(out)) result = out;
    } catch {
      // filter error is non-fatal — continue with existing messages
    }
  }
  return result;
}

/**
 * Run enabled filters' outlet(text) in priority order.
 * Returns the (possibly modified) response text.
 */
export async function applyFilterOutlet(text: string): Promise<string> {
  const filters = loadFunctionDefs()
    .filter(f => f.kind === 'filter' && f.enabled)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  let result = text;
  for (const f of filters) {
    try {
      const wrapCode = `
        ${f.code}
        if (typeof outlet === 'function') return outlet(params.text);
        return params.text;
      `;
      const out = await _sandboxRun(wrapCode, { text: result });
      if (typeof out === 'string') result = out;
    } catch {
      // non-fatal
    }
  }
  return result;
}

/**
 * Run an action function for a given message.
 * Returns a string to inject as a new message, or null.
 */
export async function runAction(functionId: string, message: Message): Promise<string | null> {
  const fn = loadFunctionDefs().find(f => f.id === functionId && f.kind === 'action' && f.enabled);
  if (!fn) return null;
  const wrapCode = `
    ${fn.code}
    if (typeof action === 'function') return action(params.message);
    return null;
  `;
  const out = await _sandboxRun(wrapCode, { message });
  return typeof out === 'string' ? out : null;
}

/** All enabled action functions (for toolbar rendering). */
export function getEnabledActions(): FunctionDef[] {
  return loadFunctionDefs().filter(f => f.kind === 'action' && f.enabled);
}

// ── Starter examples ──────────────────────────────────────────────────────────

export const STARTER_EXAMPLES: { tool?: Omit<CustomTool, 'id'>; fn?: Omit<FunctionDef, 'id'>; label: string }[] = [
  {
    label: 'Word Count (tool)',
    tool: {
      name: 'word_count',
      description: 'Count words in a text string',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Text to count words in' } },
        required: ['text'],
      },
      code: 'return { count: params.text.trim().split(/\\s+/).filter(Boolean).length };',
      enabled: true,
    },
  },
  {
    label: 'Redact Emails (filter)',
    fn: {
      kind: 'filter',
      name: 'redact_emails',
      description: 'Redact email addresses from outgoing messages',
      code: `
function inlet(messages) {
  return messages.map(m => ({
    ...m,
    content: m.content.replace(/[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}/g, '[EMAIL REDACTED]')
  }));
}`,
      enabled: false,
      priority: 10,
    },
  },
  {
    label: 'Summarize (action)',
    fn: {
      kind: 'action',
      name: 'summarize',
      description: 'Copy a one-sentence summary of the message to the prompt',
      code: `
function action(message) {
  return 'Please summarize the following in one sentence: ' + message.content.slice(0, 500);
}`,
      enabled: false,
    },
  },
];
