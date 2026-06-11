import { toolRegistry } from './tools';

export interface CliCommandRequest {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface CliCommandResponse {
  success: boolean;
  exitCode?: number;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut: boolean;
}

export class CliToolWrapper {
  static approvalCallback: ((command: string) => Promise<boolean>) | null = null;
  private static _mockInvoke: ((cmd: string, args: any) => Promise<any>) | null = null;

  static setApprovalCallback(cb: (command: string) => Promise<boolean>): void {
    CliToolWrapper.approvalCallback = cb;
  }

  /** Legacy test shim — sets a mock invoke so tests don't need real Tauri. */
  static initializeWithTauri(invoke: (cmd: string, args: any) => Promise<any>): void {
    CliToolWrapper._mockInvoke = invoke;
  }

  static async executeCommand(req: CliCommandRequest): Promise<CliCommandResponse> {
    if (CliToolWrapper.approvalCallback) {
      const approved = await CliToolWrapper.approvalCallback(req.command);
      if (!approved) {
        return { success: false, stdout: '', stderr: '', timedOut: false, error: 'Command denied by user.' };
      }
    }

    try {
      const invoke = CliToolWrapper._mockInvoke
        ?? (await import('@tauri-apps/api/core').then(m => m.invoke).catch(() => null));
      if (!invoke) return { success: false, stdout: '', stderr: '', timedOut: false, error: 'Tauri not available' };
      const result = await invoke('run_cli', { command: req.command, cwd: req.cwd, timeoutMs: req.timeoutMs ?? 30_000 });
      return {
        success: result.exit_code === 0 && !result.timed_out,
        exitCode: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timed_out,
      };
    } catch {
      return { success: false, stdout: '', stderr: '', timedOut: false, error: 'Tauri not available' };
    }
  }

  static registerAsTool(): void {
    toolRegistry.registerTool({
      name: 'run_cli_command',
      description: 'Run a CLI command on the local machine and return output. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          args: { type: 'array', description: 'Command arguments (optional)', items: { type: 'string' } },
          cwd: { type: 'string', description: 'Working directory (optional)' },
        },
        required: ['command'],
      },
      execute: async (params: Record<string, any>) => {
        const command = params.args?.length
          ? `${params.command} ${(params.args as string[]).join(' ')}`
          : params.command as string;
        return CliToolWrapper.executeCommand({ command, cwd: params.cwd });
      },
    });
  }
}
