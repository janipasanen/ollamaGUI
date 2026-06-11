// Tauri bindings for MCP stdio transport
async function invoke(cmd: string, args: any): Promise<any> {
  try {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return await tauriInvoke(cmd, args);
  } catch {
    // Outside Tauri (tests / browser dev) — return stubs
    console.warn(`[MCP stdio] Tauri not available, stubbing ${cmd}`);
    if (cmd === 'mcp_stdio_spawn') return { success: true, session_id: args?.sessionId };
    if (cmd === 'mcp_stdio_send') return { success: true };
    if (cmd === 'mcp_stdio_read') return `{"jsonrpc":"2.0","id":1,"result":{"status":"ok"}}`;
    if (cmd === 'mcp_stdio_close') return { success: true };
    if (cmd === 'mcp_stdio_check') return true;
    return { success: false, error: 'Tauri not available' };
  }
}

export interface McpTauriStdioClient {
  sessionId: string;
  command: string;
  args: string[];
}

export class TauriMcpStdioTransport {
  private static clients: Map<string, McpTauriStdioClient> = new Map();

  static async spawnProcess(command: string, args: string[] = []): Promise<McpTauriStdioClient> {
    const sessionId = `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    
    try {
      const result = await invoke('mcp_stdio_spawn', {
        sessionId,
        command,
        args,
      });
      
      const client: McpTauriStdioClient = {
        sessionId,
        command,
        args,
      };
      
      TauriMcpStdioTransport.clients.set(sessionId, client);
      return client;
    } catch (error) {
      throw new Error(`Failed to spawn MCP process: ${error}`);
    }
  }

  static async sendRequest(client: McpTauriStdioClient, request: string): Promise<void> {
    if (!TauriMcpStdioTransport.clients.has(client.sessionId)) {
      throw new Error('Client not found');
    }
    
    try {
      await invoke('mcp_stdio_send', {
        sessionId: client.sessionId,
        request,
      });
    } catch (error) {
      throw new Error(`Failed to send MCP request: ${error}`);
    }
  }

  static async readResponse(client: McpTauriStdioClient): Promise<string | null> {
    if (!TauriMcpStdioTransport.clients.has(client.sessionId)) {
      throw new Error('Client not found');
    }
    
    try {
      const result = await invoke('mcp_stdio_read', {
        sessionId: client.sessionId,
      });
      return result as string | null;
    } catch (error) {
      throw new Error(`Failed to read MCP response: ${error}`);
    }
  }

  static async closeProcess(client: McpTauriStdioClient): Promise<void> {
    try {
      await invoke('mcp_stdio_close', {
        sessionId: client.sessionId,
      });
      TauriMcpStdioTransport.clients.delete(client.sessionId);
    } catch (error) {
      console.error(`Error closing MCP process: ${error}`);
    }
  }

  static async checkProcessAlive(sessionId: string): Promise<boolean> {
    try {
      return await invoke('mcp_stdio_check', { sessionId }) as boolean;
    } catch (error) {
      return false;
    }
  }

  static async executeWithResponse(client: McpTauriStdioClient, request: string, timeoutMs: number = 5000): Promise<string> {
    await TauriMcpStdioTransport.sendRequest(client, request);
    
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const response = await TauriMcpStdioTransport.readResponse(client);
      if (response) {
        return response;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error('Timeout waiting for MCP response');
  }
}