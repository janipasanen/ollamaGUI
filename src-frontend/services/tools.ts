export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: Record<string, unknown>;
    }>;
    required?: string[];
  };
  execute: (params: any) => Promise<any>;
  /** If true, this tool only reads state and never mutates it. Used by readOnly mode and SmartApprove. */
  readOnly?: boolean;
  /**
   * If true, this tool is safe to run concurrently with other parallelSafe
   * tools in the same batch (#587). Independent read-only tools (read_file,
   * list_dir, search_files, …) may be grouped and executed in parallel; the
   * browser read-only tools are intentionally excluded because they share one
   * CDP engine. Tools without this flag always execute strictly sequentially.
   */
  parallelSafe?: boolean;
}

export interface ToolCall {
  id?: string;
  type?: 'function';
  /** Some Ollama models send { name, arguments } without nested function (#445/#449). */
  function?: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
  /** Fallback name used by some LLM outputs (e.g. Ollama tool calls). */
  name?: string;
  /** Fallback arguments used when function is absent (some Ollama models). */
  arguments?: string | Record<string, unknown>;
}

export function toolCallName(toolCall: ToolCall): string {
  return toolCall.name ?? toolCall.function?.name ?? 'unknown';
}

export function toolCallArgs(toolCall: ToolCall): Record<string, unknown> {
  const args = toolCall.function?.arguments ?? toolCall.arguments;
  if (typeof args === 'string') {
    try { return JSON.parse(args) as Record<string, unknown>; }
    catch { return {}; } // malformed JSON from model — let tool validation surface the error (#464)
  }
  return (args ?? {}) as Record<string, unknown>;
}

export interface ToolResult {
  /** Required by strict OpenAI-compatible APIs; optional for more lenient backends. */
  tool_call_id?: string;
  role?: 'tool';
  name: string;
  content: string;
}

/** Concurrency cap for parallel-safe tool groups (#587). */
export const PARALLEL_TOOL_CONCURRENCY = 4;

/**
 * Outcome of executing one prepared tool call. `notify` mirrors the historical
 * per-call behavior: `true` for a real result (success or blocked), `false` for
 * an execution error, so the `onToolResult` callback fires in exactly the same
 * places it did before batching existed.
 */
export interface ToolExecution {
  result: ToolResult;
  notify: boolean;
}

/**
 * Options for {@link runToolCalls}. The helper owns only grouping, ordering and
 * abort handling; every side effect lives in a callback so both the Ollama
 * (agent.ts) and OpenAI (openAiAgent.ts) loops can reuse it verbatim.
 */
export interface ToolBatchOptions<M extends object = any> {
  /** True when this tool call may be grouped with parallelSafe calls. */
  isSafe: (toolCall: ToolCall) => boolean;
  /** Optional abort signal. A new group is never started once it is aborted. */
  signal?: AbortSignal;
  /** Max tool calls executed concurrently within a group (default PARALLEL_TOOL_CONCURRENCY). */
  concurrency?: number;
  /**
   * Sequential gate run per call BEFORE execute. Return a blocked ToolResult
   * (filter/read-only-mode/approval/hook) to skip execution, or null to proceed.
   */
  gate: (toolCall: ToolCall) => Promise<ToolResult | null>;
  /** Execute one prepared call. Must catch its own errors and return an error ToolResult. */
  execute: (toolCall: ToolCall) => Promise<ToolExecution>;
  /** Produce the content pushed to the conversation store (post-hook + truncate). */
  postProcess: (toolCall: ToolCall, result: ToolResult) => Promise<string>;
  /**
   * Emit one result to the UI + store (in order). Returns the message to yield
   * to the caller's generator, or undefined to skip yielding. Must perform the
   * store push and onToolResult callback before returning (so ordering and the
   * "store before yield" invariant hold).
   */
  emit: (
    toolCall: ToolCall,
    result: ToolResult,
    storeContent: string,
    notify: boolean,
  ) => Promise<M | undefined>;
}

/**
 * Execute a batch of tool calls, preserving original order (#587).
 *
 * A contiguous run of parallel-safe tool calls is gated, executed and flushed
 * as one ordered group (cap at `concurrency`). Everything else — mutating
 * tools, gaps between runs, and the approval/pre-hook chains — stays strictly
 * sequential and in place. Results (blocked and executed) are always emitted in
 * the original call order, and no new group is started once `signal` aborts.
 * Post-hooks run sequentially per call (phase 3), never inside the parallel
 * execute step, so hook chains keep their ordering guarantees.
 *
 * Returns the yielded messages in the original call order; the caller is
 * responsible for `yield`-ing each one from its own generator.
 *
 * @param M The message type returned by `emit` (e.g. the conversation message).
 */
export async function runToolCalls<M extends object>(
  toolCalls: ToolCall[],
  options: ToolBatchOptions<M>,
): Promise<M[]> {
  const concurrency = options.concurrency ?? PARALLEL_TOOL_CONCURRENCY;
  const N = toolCalls.length;
  const out: M[] = [];
  let i = 0;

  while (i < N) {
    // Group boundary: never begin a new group once the run has been aborted.
    // This also makes the previously-uninterruptible Ollama batch loop stoppable.
    if (options.signal?.aborted) break;

    const toolCall = toolCalls[i];

    // Sequential path: mutating tools, non-parallel-safe tools, and run gaps.
    if (!options.isSafe(toolCall)) {
      const blocked = await options.gate(toolCall);
      if (blocked) {
        const msg = await options.emit(toolCall, blocked, blocked.content, true);
        if (msg !== undefined) out.push(msg);
        i++;
        continue;
      }
      const exec = await options.execute(toolCall);
      const storeContent = exec.notify
        ? await options.postProcess(toolCall, exec.result)
        : exec.result.content;
      const msg = await options.emit(toolCall, exec.result, storeContent, exec.notify);
      if (msg !== undefined) out.push(msg);
      i++;
      continue;
    }

    // Parallel group: gather a contiguous run of parallel-safe calls, capped so
    // the group size itself is the effective concurrency limit.
    const group: ToolCall[] = [];
    let j = i;
    while (j < N && options.isSafe(toolCalls[j]) && group.length < concurrency) {
      group.push(toolCalls[j]);
      j++;
    }

    // Phase 1 — gate each group member sequentially, in original order.
    const prepared: number[] = [];       // positions inside the group
    const blocked: { pos: number; toolCall: ToolCall; result: ToolResult }[] = [];
    for (let g = 0; g < group.length; g++) {
      const b = await options.gate(group[g]);
      if (b) blocked.push({ pos: g, toolCall: group[g], result: b });
      else prepared.push(g);
    }

    // Phase 2 — execute the prepared members concurrently. Each captures its
    // group position so ordering can be restored on flush (execute catches its
    // own errors and returns an error ToolExecution with notify=false).
    const executed: { pos: number; toolCall: ToolCall; exec: ToolExecution }[] = await Promise.all(
      prepared.map(async (pos) => ({ pos, toolCall: group[pos], exec: await options.execute(group[pos]) }))
    );

    // Phase 3 — finalize strictly in the original call order. Blocked and error
    // results flush their content directly; successful results run through
    // postProcess first to build the model-store copy. Each emit appends the
    // message to `out` in call order.
    const entries = [
      ...blocked.map((e) => ({ pos: e.pos, toolCall: e.toolCall, result: e.result, blocked: true as const })),
      ...executed.map((e) => ({ pos: e.pos, toolCall: e.toolCall, result: e.exec.result, blocked: false as const, notify: e.exec.notify })),
    ].sort((a, b) => a.pos - b.pos);
    for (const entry of entries) {
      if (entry.blocked || !entry.notify) {
        const msg = await options.emit(entry.toolCall, entry.result, entry.result.content, entry.blocked);
        if (msg !== undefined) out.push(msg);
        continue;
      }
      const storeContent = await options.postProcess(entry.toolCall, entry.result);
      const msg = await options.emit(entry.toolCall, entry.result, storeContent, entry.notify);
      if (msg !== undefined) out.push(msg);
    }
    i = j;
  }

  return out;
}

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }
  
  unregisterTool(name: string): void {
    this.tools.delete(name);
  }
  
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
  
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
  
  getOllamaToolDefinitions(): any[] {
    return this.getAllTools().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
  
  async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
    const toolName = toolCallName(toolCall);
    const tool = this.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }
    
    const params = toolCallArgs(toolCall);
    const result = await tool.execute(params);
    
    return {
      tool_call_id: toolCall.id ?? 'unknown',
      role: 'tool',
      name: toolName,
      content: JSON.stringify(result),
    };
  }
}

export const toolRegistry = new ToolRegistry();

// Allowlist of commands approved for the current session only.
// Intentionally NOT persisted to localStorage — auto-approvals reset on restart
// to prevent a compromised renderer from exploiting stale approvals.
export const cliAllowlist = new Set<string>();

export function persistCliAllowlist(): void {
  // no-op: session-only by design
}

// ── Tool-output truncation (#396, Codex/Claude/Cursor parity) ────────────────
//
// Tool results are fed back into the model context. Without a cap, a single
// large `read_file`, `run_shell_command`, or test run can exhaust the context
// window and degrade the agentic loop. The UI keeps the full output; only the
// copy sent to the model is truncated.

/** Maximum characters of a tool result forwarded to the model context. */
export const MAX_TOOL_OUTPUT_CHARS = 20_000;

/**
 * Truncate `content` to at most `limit` characters, appending a notice when
 * content was trimmed so the model knows output was elided.
 */
export function truncateToolContent(content: string, limit: number = MAX_TOOL_OUTPUT_CHARS): string {
  if (content.length <= limit) return content;
  const omitted = content.length - limit;
  return `${content.slice(0, limit)}\n…[output truncated: ${omitted} chars omitted]`;
}

interface CliResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

/**
 * Register the `run_shell_command` tool backed by the Rust `run_cli` Tauri command.
 * `onApprovalRequired` is called whenever a command is not in the allowlist;
 * it should show the approval modal and return true (allow) or false (deny).
 */
export function registerCliTool(
  onApprovalRequired: (command: string, cwd?: string) => Promise<boolean>
): void {
  toolRegistry.registerTool({
    name: 'run_shell_command',
    description:
      'Run a shell command on the local machine and return stdout/stderr. Requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute (passed to sh -c on Unix, cmd /C on Windows).',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command (optional).',
        },
      },
      required: ['command'],
    },
    execute: async (params: Record<string, any>) => {
      const command = params.command as string;
      // Default to the open workspace so `gh issue list`, `git status`, `npm
      // test` etc. target the user's project rather than the app's own working
      // directory (#490). The model routinely omits cwd, and run_cli only calls
      // current_dir() when one is supplied.
      let cwd = params.cwd as string | undefined;
      if (!cwd) {
        try {
          const { getWorkspaceRoot } = await import('./fileTools');
          cwd = getWorkspaceRoot() ?? undefined;
        } catch {
          // fileTools unavailable — fall through with no cwd
        }
      }

      if (!cliAllowlist.has(command)) {
        // Approve against the directory the command will actually run in.
        const approved = await onApprovalRequired(command, cwd);
        if (!approved) {
          return { error: 'Command denied by user.', exit_code: -1 };
        }
      }

      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<CliResult>('run_cli', {
        command,
        cwd,
        timeoutMs: 30_000,
      });

      const output = result.timed_out
        ? `[TIMED OUT]\n${result.stderr}`
        : `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ''}`.trim();

      return {
        output: output || '(no output)',
        exit_code: result.exit_code,
        timed_out: result.timed_out,
      };
    },
  });
}

// ── One-shot CLI execution for the /run slash command (#353) ──────────────────
/** Test seam — set to a stub to avoid real Tauri calls in tests. */
export const _cliMocks = {
  invoke: null as ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null,
};

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

/** Run a shell command once via the Rust `run_cli` Tauri command. */
export async function runCliOnce(
  command: string,
  cwd?: string,
  timeoutMs = 30_000,
): Promise<RunCliResult> {
  if (_cliMocks.invoke) return _cliMocks.invoke('run_cli', { command, cwd, timeoutMs }) as Promise<RunCliResult>;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<RunCliResult>('run_cli', { command, cwd, timeoutMs });
}

// Built-in tools
// ── #612: safe arithmetic evaluation for the `calculate` tool ────────────────
// The previous `calculate` used `new Function('return (...)')`, which could
// execute arbitrary code from a model-supplied expression. This tokenizer +
// recursive-descent parser accepts only numeric literals, the operators
// + - * / % and unary minus, parentheses, and a fixed set of Math
// functions/constants — no identifier can escape to executable code.

const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs, sqrt: Math.sqrt, cbrt: Math.cbrt,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  log: Math.log, log2: Math.log2, log10: Math.log10, exp: Math.exp,
  pow: Math.pow, min: Math.min, max: Math.max,
};
const MATH_CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Tok =
  | { type: 'num'; value: number }
  | { type: 'op'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }
  | { type: 'func'; value: string }
  | { type: 'const'; value: string };

function tokenizeArithmetic(input: string): Tok[] {
  const tokens: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i;
      while (j < input.length && ((input[j] >= '0' && input[j] <= '9') || input[j] === '.')) j++;
      if (input[j] === 'e' || input[j] === 'E') {
        let k = j + 1;
        if (input[k] === '+' || input[k] === '-') k++;
        if (k < input.length && input[k] >= '0' && input[k] <= '9') {
          k++;
          while (k < input.length && input[k] >= '0' && input[k] <= '9') k++;
          j = k;
        }
      }
      const num = parseFloat(input.slice(i, j));
      if (Number.isNaN(num)) throw new Error('Bad number');
      tokens.push({ type: 'num', value: num });
      i = j;
      continue;
    }
    if (c === '(') { tokens.push({ type: 'lparen' }); }
    else if (c === ')') { tokens.push({ type: 'rparen' }); }
    else if (c === ',') { tokens.push({ type: 'comma' }); }
    else if (c === '+' || c === '-' || c === '*' || c === '/' || c === '%') { tokens.push({ type: 'op', value: c }); }
    else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      const name = input.slice(i, j);
      const lower = name.toLowerCase();
      if (MATH_FUNCTIONS[lower]) tokens.push({ type: 'func', value: lower });
      else if (MATH_CONSTANTS[lower]) tokens.push({ type: 'const', value: lower });
      else throw new Error(`Unknown identifier: ${name}`);
      i = j;
      continue;
    }
    else { throw new Error(`Unexpected character: ${c}`); }
    i++;
  }
  return tokens;
}

// Parse + evaluate an arithmetic expression safely. Returns NaN for anything
// it cannot make numeric; callers should treat non-finite results as errors.
export function evaluateArithmetic(input: string): number {
  const tokens = tokenizeArithmetic(input);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const parseExpression = (): number => {
    let value = parseTerm();
    while (true) {
      const tok = peek();
      if (tok && tok.type === 'op' && (tok.value === '+' || tok.value === '-')) {
        next();
        value = tok.value === '+' ? value + parseTerm() : value - parseTerm();
      } else break;
    }
    return value;
  };
  const parseTerm = (): number => {
    let value = parseFactor();
    while (true) {
      const tok = peek();
      if (tok && tok.type === 'op' && (tok.value === '*' || tok.value === '/' || tok.value === '%')) {
        next();
        value = tok.value === '*' ? value * parseFactor() : tok.value === '/' ? value / parseFactor() : value % parseFactor();
      } else break;
    }
    return value;
  };
  const parseFactor = (): number => {
    const tok = peek();
    if (tok && tok.type === 'op' && (tok.value === '-' || tok.value === '+')) {
      next();
      const v = parseFactor();
      return tok.value === '-' ? -v : v;
    }
    return parsePrimary();
  };
  const parsePrimary = (): number => {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end of expression');
    if (tok.type === 'num') { next(); return tok.value; }
    if (tok.type === 'const') { next(); return MATH_CONSTANTS[tok.value]; }
    if (tok.type === 'lparen') {
      next();
      const value = parseExpression();
      if (!peek() || peek()!.type !== 'rparen') throw new Error('Expected )');
      next();
      return value;
    }
    if (tok.type === 'func') {
      next();
      if (!peek() || peek()!.type !== 'lparen') throw new Error('Expected (');
      next();
      const args: number[] = [];
      if (peek() && peek()!.type !== 'rparen') {
        args.push(parseExpression());
        while (peek()?.type === 'comma') { next(); args.push(parseExpression()); }
      }
      if (!peek() || peek()!.type !== 'rparen') throw new Error('Expected )');
      next();
      return MATH_FUNCTIONS[tok.value](...args);
    }
    throw new Error('Unexpected token');
  };
  const value = parseExpression();
  if (pos < tokens.length) throw new Error('Trailing characters');
  return value;
}

export function registerBuiltInTools() {
  // System information tool
  toolRegistry.registerTool({
    name: 'get_system_info',
    description: 'Get basic system information',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => ({
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      language: navigator.language,
      timestamp: new Date().toISOString(),
    }),
  });
  
  // Time tool
  toolRegistry.registerTool({
    name: 'get_current_time',
    description: 'Get the current time in ISO format',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => ({
      time: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  
  // Calculator tool
  toolRegistry.registerTool({
    name: 'calculate',
    description: 'Perform a mathematical calculation',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The mathematical expression to evaluate',
        },
      },
      required: ['expression'],
    },
    execute: async (params: { expression: string }) => {
      try {
        // Safe recursive-descent arithmetic parser (#612); never runs raw input
        // as code. Reject any non-finite result as an invalid expression.
        if (typeof params.expression !== 'string') return { error: 'Invalid expression' };
        const result = evaluateArithmetic(params.expression.trim());
        if (typeof result !== 'number' || !Number.isFinite(result)) return { error: 'Invalid expression' };
        return { result };
      } catch {
        return { error: 'Invalid expression' };
      }
    },
  });
  
  // Text processing tool
  toolRegistry.registerTool({
    name: 'text_process',
    description: 'Process text (uppercase, lowercase, reverse, etc.)',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text to process',
        },
        operation: {
          type: 'string',
          description: 'The operation to perform (uppercase, lowercase, reverse, length)',
          enum: ['uppercase', 'lowercase', 'reverse', 'length'],
        },
      },
      required: ['text', 'operation'],
    },
    execute: async (params: { text: string; operation: string }) => {
      switch (params.operation) {
        case 'uppercase':
          return { result: params.text.toUpperCase() };
        case 'lowercase':
          return { result: params.text.toLowerCase() };
        case 'reverse':
          return { result: params.text.split('').reverse().join('') };
        case 'length':
          return { result: params.text.length };
        default:
          return { error: 'Unknown operation' };
      }
    },
  });
}
