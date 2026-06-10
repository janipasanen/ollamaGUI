// Mock Tauri API for testing
export const invoke = vi.fn().mockImplementation(async (cmd: string, args: any) => {
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