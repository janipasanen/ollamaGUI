// MCP HTTP Transport
async function invoke(cmd: string, args: any): Promise<any> {
  try {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return await tauriInvoke(cmd, args);
  } catch {
    // Outside Tauri (tests / browser dev) — return a spec-shaped stub by method.
    console.warn(`[MCP HTTP] Tauri not available, stubbing ${cmd}`);
    if (cmd === 'mcp_http_request') {
      return {
        success: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: stubMcpResponseBody(args?.request?.body),
      };
    }
    return { success: false, error: 'Tauri not available' };
  }
}

/** Produce a spec-shaped JSON-RPC response body for a stubbed MCP request. */
function stubMcpResponseBody(requestBody: unknown): string {
  let id: number | string = 1;
  let method = '';
  try {
    const parsed = JSON.parse(typeof requestBody === 'string' ? requestBody : '{}');
    id = parsed.id ?? 1;
    method = parsed.method ?? '';
  } catch { /* fall through to default */ }

  let result: any = {};
  if (method === 'initialize') {
    result = { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'stub', version: '0.0.0' } };
  } else if (method === 'tools/list') {
    result = { tools: [] };
  } else if (method === 'tools/call') {
    result = { content: [] };
  }
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

import { McpServerConfig, McpTool, McpRequest, McpResponse, McpNotification } from './mcp';
import { getValidAccessToken } from './mcpAuth';

/** Thrown when an HTTP MCP server returns 401, so the UI can prompt re-authentication. */
export class McpReauthRequiredError extends Error {
  constructor(public sessionId: string) {
    super(`MCP server ${sessionId} requires (re-)authentication`);
    this.name = 'McpReauthRequiredError';
  }
}

export class McpHttpTransport {
  /** Test seam: set to override the real Tauri invoke. */
  static _mockInvoke: ((cmd: string, args: any) => Promise<any>) | null = null;

  /** Resolve the bearer token for a request: a valid OAuth token first, then the static config token. */
  private static async resolveAuthToken(sessionId: string, staticToken?: string): Promise<string | undefined> {
    try {
      const oauth = await getValidAccessToken(sessionId);
      if (oauth) return oauth;
    } catch {
      /* fall back to static token */
    }
    return staticToken;
  }

  private static sessions: Map<string, {
    url: string;
    authToken?: string;
    extraHeaders?: Record<string, string>;
    eventListeners: Map<string, ((data: any) => void)[]>;
  }> = new Map();

  /** Test helper: clears all sessions. */
  static clearSessions(): void {
    this.sessions.clear();
  }

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
      extraHeaders: config.headers,
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

    // Resolve auth at request time so refreshed OAuth tokens are always current.
    const authToken = await this.resolveAuthToken(sessionId, session.authToken);

    try {
      const callInvoke = McpHttpTransport._mockInvoke ?? invoke;
      const response = await callInvoke('mcp_http_request', {
        request: {
          sessionId,
          url: session.url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
            ...(session.extraHeaders ?? {}),
          },
          body: JSON.stringify(request),
          authToken,
        },
      });

      const httpResponse = response as {
        success: boolean;
        status: number;
        headers: Record<string, string>;
        body: string;
        error?: string;
      };

      // 401 → the token is invalid/expired and couldn't be refreshed; prompt re-auth.
      if (httpResponse.status === 401) {
        throw new McpReauthRequiredError(sessionId);
      }

      if (!httpResponse.success) {
        throw new Error(httpResponse.error || `HTTP request failed with status ${httpResponse.status}`);
      }

      const parsedResponse: McpResponse = JSON.parse(httpResponse.body);

      if (parsedResponse.error) {
        throw new Error(parsedResponse.error.message);
      }

      return parsedResponse.result;
    } catch (error) {
      if (error instanceof McpReauthRequiredError) throw error; // surface typed re-auth signal as-is
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
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'Ollama GUI', version: '0.1.0' },
      },
    };

    const result = await this.sendRequest(sessionId, request);
    await this.sendNotification(sessionId, 'notifications/initialized');
    return result;
  }

  static async listTools(sessionId: string): Promise<McpTool[]> {
    const request: McpRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    };

    const result = await this.sendRequest(sessionId, request);
    const tools = Array.isArray(result) ? result : (result?.tools ?? []);
    return tools.map((t: any) => ({
      name: t.name,
      description: t.description ?? '',
      parameters: t.inputSchema ?? t.parameters ?? { type: 'object', properties: {} },
    }));
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
        name: toolName,
        arguments: params,
      },
    };

    return this.sendRequest(sessionId, request);
  }

  /** Fire-and-forget JSON-RPC notification over HTTP (no id; response ignored). */
  static async sendNotification(sessionId: string, method: string, params?: any): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const body = JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
    const authToken = await this.resolveAuthToken(sessionId, session.authToken);
    try {
      const callInvoke = McpHttpTransport._mockInvoke ?? invoke;
      await callInvoke('mcp_http_request', {
        request: {
          sessionId,
          url: session.url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
            ...(session.extraHeaders ?? {}),
          },
          body,
          authToken,
        },
      });
    } catch (e) {
      console.error(`[MCP HTTP] Failed to send notification ${method}: ${e}`);
    }
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