// CLI Tool with Approval Gate
import { toolRegistry } from './tools';

export interface CliCommandRequest {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
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
  private static approvalCallback: ((command: string) => Promise<boolean>) | null = null;
  private static invoke: any = async (cmd: string, args: any) => {
    // In production, this will be replaced by the real Tauri invoke
    throw new Error('Tauri invoke not initialized. Make sure to call CliToolWrapper.initialize() in production.');
  };

  // Method to initialize with real Tauri API
  static initializeWithTauri(tauriInvoke: any): void {
    CliToolWrapper.invoke = tauriInvoke;
  }
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface CliCommandResponse {
  success: boolean;
  exitCode?: number;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut: boolean;
}

