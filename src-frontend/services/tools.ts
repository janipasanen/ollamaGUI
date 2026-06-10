export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, {
      type: string;
      description: string;
    }>;
    required?: string[];
  };
  execute: (params: Record<string, any>) => Promise<any>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
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
    const tool = this.getTool(toolCall.function.name);
    if (!tool) {
      throw new Error(`Tool ${toolCall.function.name} not found`);
    }
    
    const params = JSON.parse(toolCall.function.arguments);
    const result = await tool.execute(params);
    
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      name: toolCall.function.name,
      content: JSON.stringify(result),
    };
  }
}

export const toolRegistry = new ToolRegistry();

// Allowlist of commands the user has approved to run without re-asking.
// Persisted in localStorage under 'cli_allowlist'.
export const cliAllowlist = new Set<string>(
  JSON.parse(localStorage.getItem('cli_allowlist') ?? '[]') as string[]
);

export function persistCliAllowlist(): void {
  localStorage.setItem('cli_allowlist', JSON.stringify([...cliAllowlist]));
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
      const cwd = params.cwd as string | undefined;

      if (!cliAllowlist.has(command)) {
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

// Built-in tools
export function registerBuiltInTools() {
  // System information tool
  toolRegistry.registerTool({
    name: 'get_system_info',
    description: 'Get basic system information',
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
        // Note: In a real app, you'd want to sanitize this input
        const result = eval(params.expression); // eslint-disable-line no-eval
        return { result };
      } catch (error) {
        return { error: 'Invalid expression' };
      }
    },
  });
  
  // Text processing tool
  toolRegistry.registerTool({
    name: 'text_process',
    description: 'Process text (uppercase, lowercase, reverse, etc.)',
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