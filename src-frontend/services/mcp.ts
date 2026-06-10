// MCP (Model Context Protocol) Client Implementation
// https://github.com/ollama/mcp

import { TauriMcpStdioTransport } from './mcp-tauri';

export interface McpServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'http';
  command?: string; // For stdio servers
  url?: string; // For HTTP servers
  auth?: {
    token?: string;
    type?: 'bearer' | 'basic';
  };
  enabled: boolean;
  toolsEnabled: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  parameters: any;
}

export interface McpRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: any;
}

export interface McpResponse {
  jsonrpc: '2.0';
  id?: number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface McpNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

export class McpStdioClient {
  private process: any = null;
  private stdin: any = null;
  private stdout: any = null;
  private stderr: any = null;
  private requestIdCounter: number = 1;
  private pendingRequests: Map<number, { resolve: (value: any) => void; reject: (error: any) => void }> = new Map();
  private eventListeners: Map<string, ((data: any) => void)[]> = new Map();
  private isClosed: boolean = false;

  constructor(private config: McpServerConfig) {}

  private tauriClient: any = null;

  async connect(): Promise<void> {
    if (!this.config.command) {
      throw new Error('No command specified for stdio MCP server');
    }

    try {
      // Use Tauri transport for real process management
      this.tauriClient = await TauriMcpStdioTransport.spawnProcess(
        this.config.command,
        [] // args would go here if needed
      );

      console.log(`[MCP] Connected via Tauri: ${this.config.command}`);
      
      // Send initialization request
      await this.initialize();
      
      // Start polling for responses
      this.startResponsePolling();
    } catch (error) {
      console.error(`[MCP] Failed to connect via Tauri: ${error}`);
      throw new Error(`Failed to connect to MCP server: ${error}`);
    }
  }

  private async startResponsePolling(): Promise<void> {
    if (!this.tauriClient) return;

    // Poll for responses in the background
    const pollResponses = async () => {
      while (this.isConnected()) {
        try {
          const response = await TauriMcpStdioTransport.readResponse(this.tauriClient);
          if (response) {
            this.handleStdoutData(response);
          } else {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          console.error(`[MCP] Polling error: ${error}`);
          break;
        }
      }
    };

    // Start polling in background
    pollResponses();
  }

  private handleStdoutData(data: string): void {
    const lines = data.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const message: McpResponse | McpNotification = JSON.parse(line);
        
        // Handle JSON-RPC response
        if ('id' in message && message.id !== undefined && message.id !== null) {
          const pendingRequest = this.pendingRequests.get(message.id);
          if (pendingRequest) {
            if (message.error) {
              pendingRequest.reject(new Error(message.error.message));
            } else {
              pendingRequest.resolve(message.result);
            }
            this.pendingRequests.delete(message.id);
          }
        }
        // Handle JSON-RPC notification
        else if (message.method) {
          this.emitEvent(message.method, message.params);
        }
      } catch (error) {
        console.error(`[MCP] Error parsing line: ${line}`, error);
      }
    }
  }

  private handleProcessExit(code: number): void {
    if (this.isClosed) return;
    this.isClosed = true;
    
    console.log(`[MCP] Process exited with code ${code}`);
    
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error(`MCP process exited with code ${code}`));
    }
    this.pendingRequests.clear();
    
    this.emitEvent('disconnect', { code });
  }

  private getNextRequestId(): number {
    return this.requestIdCounter++;
  }

  private emitEvent(event: string, data: any): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(listener => listener(data));
  }

  on(event: string, listener: (data: any) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)?.push(listener);
  }

  off(event: string, listener: (data: any) => void): void {
    const listeners = this.eventListeners.get(event) || [];
    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }

  async initialize(): Promise<any> {
    const request: McpRequest = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'initialize',
      params: {
        capabilities: {
          tool_calls: true,
        }
      }
    };
    
    return this.sendRequest(request);
  }

  async listTools(): Promise<McpTool[]> {
    const request: McpRequest = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'tools/list',
    };
    
    return this.sendRequest(request);
  }

  async callTool(toolName: string, params: any): Promise<any> {
    const request: McpRequest = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'tools/call',
      params: {
        tool_name: toolName,
        parameters: params,
      }
    };
    
    return this.sendRequest(request);
  }

  private async sendRequest(request: McpRequest): Promise<any> {
    if (this.isClosed) {
      throw new Error('MCP connection is closed');
    }
    
    if (!this.tauriClient) {
      throw new Error('MCP Tauri client not initialized');
    }
    
    return new Promise((resolve, reject) => {
      const requestId = request.id || this.getNextRequestId();
      this.pendingRequests.set(requestId, { resolve, reject });
      
      // Set the ID on the request
      request.id = requestId;
      
      const jsonString = JSON.stringify(request);
      
      // Use Tauri transport to send the request
      TauriMcpStdioTransport.sendRequest(this.tauriClient, jsonString)
        .then(() => {
          // Request sent successfully, wait for response in polling
        })
        .catch(error => {
          reject(new Error(`Failed to send request: ${error}`));
        });
    });
  }

  async disconnect(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    
    console.log(`[MCP] Disconnecting from ${this.config.name}`);
    
    try {
      if (this.tauriClient) {
        await TauriMcpStdioTransport.closeProcess(this.tauriClient);
        this.tauriClient = null;
      }
    } catch (error) {
      console.error(`[MCP] Error closing process: ${error}`);
    }
    
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('MCP connection closed'));
    }
    this.pendingRequests.clear();
    
    this.emitEvent('disconnect', { code: 0 });
  }

  isConnected(): boolean {
    return !this.isClosed && this.tauriClient !== null;
  }
}

export class McpHttpClient {
  private sessionId: string;
  private authToken: string | null = null;

  constructor(private config: McpServerConfig) {
    this.sessionId = `http_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new Error('No URL specified for HTTP MCP server');
    }

    // Test connection
    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            capabilities: {
              tool_calls: true,
            }
          }
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP MCP connection failed: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(`MCP initialization error: ${result.error.message}`);
      }

      console.log(`[MCP HTTP] Connected to ${this.config.name}`);
    } catch (error) {
      console.error(`[MCP HTTP] Connection failed: ${error}`);
      throw new Error(`Failed to connect to HTTP MCP server: ${error}`);
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Add authentication if configured
    if (this.config.auth?.token) {
      if (this.config.auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${this.config.auth.token}`;
      } else if (this.config.auth.type === 'basic') {
        // In a real app, you'd base64 encode username:password
        headers['Authorization'] = `Basic ${btoa(`token:${this.config.auth.token}`)}`;
      }
    }

    return headers;
  }

  async initialize(): Promise<any> {
    const request: McpRequest = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'initialize',
      params: {
        capabilities: {
          tool_calls: true,
        }
      }
    };
    
    return this.sendRequest(request);
  }

  async listTools(): Promise<McpTool[]> {
    const request: McpRequest = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'tools/list',
    };
    
    return this.sendRequest(request);
  }

  async callTool(toolName: string, params: any): Promise<any> {
    const request: McpRequest = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'tools/call',
      params: {
        tool_name: toolName,
        parameters: params,
      }
    };
    
    return this.sendRequest(request);
  }

  private requestIdCounter: number = 1;

  private getNextRequestId(): number {
    return this.requestIdCounter++;
  }

  private async sendRequest(request: McpRequest): Promise<any> {
    if (!this.config.url) {
      throw new Error('MCP HTTP URL not configured');
    }

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`MCP request failed: ${response.statusText}`);
      }

      const result: McpResponse = await response.json();

      if (result.error) {
        throw new Error(`MCP error: ${result.error.message}`);
      }

      return result.result;
    } catch (error) {
      console.error(`[MCP HTTP] Request failed: ${error}`);
      throw new Error(`MCP request failed: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    console.log(`[MCP HTTP] Disconnected from ${this.config.name}`);
  }

  isConnected(): boolean {
    // For HTTP, we consider it connected if we have a valid URL
    return !!this.config.url;
  }
}

export class McpServerManager {
  private servers: Map<string, McpServerConfig> = new Map();
  private activeConnections: Map<string, McpStdioClient | McpHttpClient> = new Map();

  addServer(config: McpServerConfig): void {
    this.servers.set(config.id, config);
  }

  removeServer(id: string): void {
    // Disconnect if connected
    if (this.activeConnections.has(id)) {
      this.activeConnections.get(id)?.disconnect();
      this.activeConnections.delete(id);
    }
    this.servers.delete(id);
  }

  getServer(id: string): McpServerConfig | undefined {
    return this.servers.get(id);
  }

  getAllServers(): McpServerConfig[] {
    return Array.from(this.servers.values());
  }

  async connectToServer(id: string): Promise<McpStdioClient | McpHttpClient> {
    const config = this.servers.get(id);
    if (!config) {
      throw new Error(`Server ${id} not found`);
    }
    
    if (this.activeConnections.has(id)) {
      return this.activeConnections.get(id)!;
    }
    
    let client: McpStdioClient | McpHttpClient;
    
    if (config.type === 'stdio') {
      client = new McpStdioClient(config);
    } else if (config.type === 'http') {
      client = new McpHttpClient(config);
    } else {
      throw new Error(`Unsupported MCP server type: ${config.type}`);
    }
    
    await client.connect();
    this.activeConnections.set(id, client);
    
    return client;
  }

  disconnectFromServer(id: string): void {
    const connection = this.activeConnections.get(id);
    if (connection) {
      connection.disconnect();
      this.activeConnections.delete(id);
    }
  }

  async discoverTools(serverId: string): Promise<McpTool[]> {
    const client = await this.connectToServer(serverId);
    return client.listTools();
  }

  getActiveConnection(serverId: string): McpStdioClient | McpHttpClient | undefined {
    return this.activeConnections.get(serverId);
  }
}

export const mcpServerManager = new McpServerManager();