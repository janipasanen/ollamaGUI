// MCP HTTP Transport
// Mock for testing environment
let invoke: any = async (cmd: string, args: any) => {
  console.log(`[MOCK] Tauri invoke: ${cmd}`, args);
  
  if (cmd === 'mcp_http_request') {
    // Simulate a successful HTTP response
    return {
      success: true,
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: args.request.body || '{"jsonrpc":"2.0","id":1,"result":{}}',
    };
  }
  
  return { success: false, error: 'Unknown command' };
};

// Allow tests to override the mock
if (import.meta.env?.MODE === 'test') {
  invoke = vi.fn().mockImplementation(async (cmd: string, args: any) => {
    if (cmd === 'mcp_http_request') {
      return {
        success: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: args.request.body || '{"jsonrpc":"2.0","id":1,"result":{}}',
      };
    }
    return { success: false, error: 'Unknown command' };
  });
}

import { McpServerConfig, McpTool, McpRequest, McpResponse, McpNotification } from './mcp';

export class McpHttpTransport {
  private static sessions: Map<string, {
    url: string;
    authToken?: string;
    eventListeners: Map<string, ((data: any) => void)[]>;
  }> = new Map();

  static async initializeSession(config: McpServerConfig): Promise<void> {
    if (config.type !== 'http' || !config.url) {
      throw new Error('HTTP transport requires a valid URL');
    }

    if (this.sessions.has(config.id)) {
      return; // Already initialized
    }

    this.sessions.set(config.id, {
      url: config.url,
      authToken: config.auth?.token,
      eventListeners: new Map(),
    });
  }

  static async sendRequest(
    sessionId: string,
    request: McpRequest
  ): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const response = await invoke('mcp_http_request', {
        request: {
          sessionId,
          url: session.url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(session.authToken ? { 'Authorization': `Bearer ${session.authToken}` } : {}),
          },
          body: JSON.stringify(request),
          authToken: session.authToken,
        },
      });

      const httpResponse = response as {
        success: boolean;
        status: number;
        headers: Record<string, string>;
        body: string;
        error?: string;
      };

      if (!httpResponse.success) {
        throw new Error(httpResponse.error || `HTTP request failed with status ${httpResponse.status}`);
      }

      const parsedResponse: McpResponse = JSON.parse(httpResponse.body);

      if (parsedResponse.error) {
        throw new Error(parsedResponse.error.message);
      }

      return parsedResponse.result;
    } catch (error) {
      console.error(`[MCP HTTP] Request failed: ${error}`);
      throw new Error(`MCP HTTP request failed: ${error}`);
    }
  }

  static async initialize(sessionId: string): Promise<any> {
    const request: McpRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        capabilities: {
          tool_calls: true,
        },
      },
    };
    
    return this.sendRequest(sessionId, request);
  }

  static async listTools(sessionId: string): Promise<McpTool[]> {
    const request: McpRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    };
    
    return this.sendRequest(sessionId, request);
  }

  static async callTool(
    sessionId: string,
    toolName: string,
    params: any
  ): Promise<any> {
    const request: McpRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        tool_name: toolName,
        parameters: params,
      },
    };
    
    return this.sendRequest(sessionId, request);
  }

  static on(sessionId: string, event: string, listener: (data: any) => void): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    if (!session.eventListeners.has(event)) {
      session.eventListeners.set(event, []);
    }
    session.eventListeners.get(event)?.push(listener);
  }

  static off(sessionId: string, event: string, listener: (data: any) => void): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    const listeners = session.eventListeners.get(event) || [];
    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }

  static emit(sessionId: string, event: string, data: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    const listeners = session.eventListeners.get(event) || [];
    listeners.forEach(listener => listener(data));
  }

  static closeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  static isConnected(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}