// Test setup file
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { CliToolWrapper } from '../services/cli-tool';

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock fetch for all tests — individual tests can override via vi.spyOn / mockResolvedValue
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ models: [] }),
  body: null,
  text: async () => '',
});

// Mock Tauri invoke for CLI tool
const mockInvoke = vi.fn().mockImplementation(async (cmd: string, args: any) => {
  console.log(`[MOCK] Tauri invoke: ${cmd}`, args);
  
  if (cmd === 'run_cli_command') {
    return {
      success: true,
      exitCode: 0,
      stdout: "Mock command output",
      stderr: "",
      timedOut: false,
    };
  }
  
  if (cmd === 'mcp_stdio_spawn') {
    return {
      success: true,
      message: `Process spawned with session ID: ${args.sessionId}`,
      session_id: args.sessionId,
    };
  }
  
  if (cmd === 'mcp_stdio_send') {
    return {
      success: true,
      message: "Request sent",
      session_id: args.sessionId,
    };
  }
  
  if (cmd === 'mcp_stdio_read') {
    return `{"jsonrpc":"2.0","id":1,"result":{"status":"ok"}}`;
  }
  
  if (cmd === 'mcp_stdio_close') {
    return {
      success: true,
      message: "Process terminated",
      session_id: args.sessionId,
    };
  }
  
  if (cmd === 'mcp_stdio_check') {
    return true;
  }
  
  return { success: false, error: 'Unknown command' };
});

// Initialize CLI tool with mock
CliToolWrapper.initializeWithTauri(mockInvoke);