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

/**
 * Coerce a raw tool-call payload from either provider into the shared
 * {@link ToolCall} shape (G6). Both the Ollama-native and OpenAI-compatible
 * dialects are tolerated:
 *
 * - OpenAI-compatible: `{ id, type: 'function', function: { name, arguments } }`
 *   where `arguments` may be a JSON string or an already-parsed object.
 * - Ollama-native: `{ name, arguments }`, `{ function: { name } }`, or
 *   `{ id, function: { name } }` variants.
 * - A partial SSE fragment (e.g. an OpenAI stream chunk whose `function`
 *   carries no `name`/`arguments`) yields `null` so it is skipped rather than
 *   minting a phantom call.
 *
 * Never throws — malformed or empty input returns `null` so callers can
 * safely skip it. This is what lets a provider send an unexpected shape
 * degrade gracefully instead of crashing or dispatching a nameless tool.
 */
export function normalizeToolCall(raw: any): ToolCall | null {
  if (!raw || typeof raw !== 'object') return null;

  const maybe = raw as ToolCall;

  // Prefer explicit function.name, fall back to the top-level name.
  const name = maybe.function?.name ?? maybe.name ?? undefined;
  if (!name || String(name).trim().length === 0) return null;

  const id = maybe.id;
  const type = maybe.type ?? 'function';
  const arguments_ = maybe.function?.arguments ?? maybe.arguments ?? undefined;

  // Reject a fragment that carries a name but no usable argument payload —
  // otherwise empty fragments (`{ function: { name } }` with no args, or
  // `tool_calls: []`) would be treated as real calls.
  if (arguments_ === undefined) return null;

  const normalized: ToolCall = { id, type, name, arguments: arguments_ };
  if (maybe.function) {
    normalized.function = {
      name: String(name),
      arguments: arguments_,
    };
  }
  return normalized;
}

export function toolCallName(toolCall: ToolCall): string {
  return normalizeToolCall(toolCall)?.name ?? toolCall.name ?? toolCall.function?.name ?? 'unknown';
}

export function toolCallArgs(toolCall: ToolCall): Record<string, unknown> {
  const args = normalizeToolCall(toolCall)?.arguments ?? toolCall.function?.arguments ?? toolCall.arguments;
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

/**
 * The binary (first token) of a command line, for binary-level allowlisting.
 * "Always allow" on `npm test` should also cover `npm run build` — exact-string
 * matching made every unique command line prompt again, which turned 'auto'
 * runs into an approval treadmill.
 */
export function commandBinary(command: string): string {
  return command.trim().split(/\s+/)[0] ?? '';
}

/** True when the command is covered by an exact or binary-level approval. */
export function isCommandAllowlisted(command: string): boolean {
  if (cliAllowlist.has(command)) return true;
  const bin = commandBinary(command);
  return bin !== '' && cliAllowlist.has(bin);
}

/**
 * The core toolset sent with agentic requests (#audit-3). Every registered
 * tool used to ship with every request — ~60+ definitions that alone could
 * fill a small context window. This is the task-relevant working set; MCP and
 * user-registered tools are appended by the caller.
 */
export const CORE_AGENT_TOOLS = [
  'read_file', 'write_file', 'apply_edit', 'apply_patch',
  'list_dir', 'glob_files', 'search_files',
  'run_shell_command', 'run_tests', 'run_checks',
  'git_diff', 'git_status', 'update_plan',
] as const;

// The approval callback registered by the UI, kept module-level so other
// command-running tools (run_tests / run_checks overrides) share the SAME
// approval policy as run_shell_command instead of opening an unaudited path.
let _cliApprovalCallback: ((command: string, cwd?: string) => Promise<boolean>) | null = null;

/**
 * Request approval for a command under the shared CLI policy: allowlisted
 * commands pass silently; otherwise the UI approval callback decides. With no
 * callback registered (tests / headless), commands are allowed.
 */
export async function requestCliApproval(command: string, cwd?: string): Promise<boolean> {
  if (isCommandAllowlisted(command)) return true;
  if (!_cliApprovalCallback) return true;
  return _cliApprovalCallback(command, cwd);
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

/** Long-running checks/builds must not be cut off at the old 30 s default. */
export const DEFAULT_SHELL_COMMAND_TIMEOUT_MS = 120_000;

/**
 * Register the `run_shell_command` tool backed by the Rust `run_cli` Tauri command.
 * `onApprovalRequired` is called whenever a command is not in the allowlist;
 * it should show the approval modal and return true (allow) or false (deny).
 */
export function registerCliTool(
  onApprovalRequired: (command: string, cwd?: string) => Promise<boolean>
): void {
  _cliApprovalCallback = onApprovalRequired;
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
        timeout_ms: {
          type: 'number',
          description: 'Timeout in milliseconds (default 120000, maximum 600000).',
        },
      },
      required: ['command'],
    },
    execute: async (params: Record<string, any>) => {
      const command = params.command as string;
      const requestedTimeout = params.timeout_ms as number | undefined;
      const timeoutMs = typeof requestedTimeout === 'number' && Number.isFinite(requestedTimeout) && requestedTimeout > 0
        ? Math.min(Math.floor(requestedTimeout), 10 * 60_000)
        : DEFAULT_SHELL_COMMAND_TIMEOUT_MS;
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

      if (!isCommandAllowlisted(command)) {
        // Approve against the directory the command will actually run in.
        const approved = await onApprovalRequired(command, cwd);
        if (!approved) {
          return { error: 'Command denied by user.', exit_code: -1 };
        }
      }

      const { invoke } = await import('@tauri-apps/api');
      const result = await invoke<CliResult>('run_cli', {
        command,
        cwd,
        timeoutMs,
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
  timeoutMs = DEFAULT_SHELL_COMMAND_TIMEOUT_MS,
): Promise<RunCliResult> {
  if (_cliMocks.invoke) return _cliMocks.invoke('run_cli', { command, cwd, timeoutMs }) as Promise<RunCliResult>;
  const { invoke } = await import('@tauri-apps/api');
  return invoke<RunCliResult>('run_cli', { command, cwd, timeoutMs });
}

// Built-in tools
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
    readOnly: true,
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
        // Use Function constructor (sandboxed scope) instead of eval
        const fn = new Function('return (' + params.expression + ')');
        const result = fn();
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
