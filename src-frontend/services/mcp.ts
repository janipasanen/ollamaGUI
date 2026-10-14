// MCP (Model Context Protocol) Client Implementation
// Spec: https://modelcontextprotocol.io/specification/2025-06-18

import { TauriMcpStdioTransport } from './mcp-tauri';
import { McpHttpTransport, McpReauthRequiredError } from './mcp-http';
import { checkRateLimit } from './rateLimiter';

// MCP protocol handshake constants (spec 2025-06-18, basic/lifecycle).
export const MCP_PROTOCOL_VERSION = '2025-06-18';

/**
 * Protocol versions this client can operate. Lifecycle §Version Negotiation:
 * the client MUST send a version it supports (SHOULD be its latest); if the
 * server counter-offers a different version the client either accepts it (when
 * supported) or SHOULD disconnect. The wire shape of everything this client
 * uses (initialize, tools/list, tools/call, notifications/initialized) is
 * identical across these three revisions.
 */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const MCP_CLIENT_INFO = { name: 'Ollama GUI', version: '0.1.0' };

/**
 * initialize params (lifecycle §Initialization): latest protocolVersion,
 * capabilities, clientInfo{name,version}. `capabilities` is intentionally
 * empty — this client implements none of the optional client features
 * (roots / sampling / elicitation), and lifecycle §Capability Negotiation
 * says to only advertise capabilities that are actually supported.
 */
export const MCP_INITIALIZE_PARAMS = {
  protocolVersion: MCP_PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: MCP_CLIENT_INFO,
};

/**
 * JSON-RPC 2.0 error surfaced from an MCP server, preserving the error
 * object's `code` and `data` instead of flattening to the message string
 * (JSON-RPC 2.0 §5.1 / MCP tools §Error Handling "Protocol Errors").
 */
export class McpJsonRpcError extends Error {
  constructor(public code: number, message: string, public data?: any) {
    super(message);
    this.name = 'McpJsonRpcError';
  }
}

/**
 * Validate the server's initialize response version (lifecycle §Version
 * Negotiation). The server either echoes the requested version or
 * counter-offers its own latest; if we don't support the offered version the
 * client SHOULD disconnect — callers must treat a throw here as fatal for the
 * connection. Returns the negotiated version string.
 */
export function negotiateProtocolVersion(initializeResult: any): string {
  const offered = initializeResult?.protocolVersion;
  if (typeof offered !== 'string' || !MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(offered)) {
    throw new Error(
      `Unsupported MCP protocol version from server: ${offered ?? '(missing)'} — ` +
      `client supports ${MCP_SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`
    );
  }
  return offered;
}

/**
 * Flatten the text items of a tools/call result `content` array
 * (spec server/tools §Tool Result) into a single string.
 */
export function extractMcpToolResultText(result: any): string {
  const items = Array.isArray(result?.content) ? result.content : [];
  return items
    .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
    .map((c: any) => c.text)
    .join('\n');
}

/** Default per-request timeout for stdio MCP servers (#446). */
const MCP_DEFAULT_TIMEOUT_MS = 30_000;

/** Normalize a `tools/list` result (or a raw array) into McpTool[], mapping inputSchema -> parameters. */
export function normalizeToolsList(result: any): McpTool[] {
  const tools = Array.isArray(result) ? result : (result?.tools ?? []);
  return tools.map((t: any) => ({
    name: t.name,
    description: t.description ?? '',
    parameters: t.inputSchema ?? t.parameters ?? { type: 'object', properties: {} },
  }));
}

export interface McpServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'http';
  command?: string; // For stdio servers
  args?: string[]; // Extra args appended to a stdio command
  env?: Record<string, string>; // Per-server env vars (credential tokens) for stdio servers
  url?: string; // For HTTP servers
  headers?: Record<string, string>; // For HTTP servers
  auth?: {
    token?: string;
    type?: 'bearer' | 'basic';
  };
  enabled?: boolean;
  toolsEnabled?: boolean;
  tools?: McpTool[];
  lastConnected?: number;
  /** Per-request timeout in ms for stdio servers (default 30 000). #446 */
  timeoutMs?: number;
}

export interface McpTool {
  name: string;
  description: string;
  parameters: any;
  enabled?: boolean;
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

/**
 * Split a command line into the executable and its arguments, honoring single
 * and double quotes (so paths/values with spaces survive). Returns the first
 * token as `bin` and the rest as `args`.
 */
export function splitCommandLine(commandLine: string): { bin: string; args: string[] } {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(commandLine)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  return { bin: tokens[0] ?? '', args: tokens.slice(1) };
}

export class McpStdioClient {
  private process: any = null;
  private stdin: any = null;
  private stdout: any = null;
  private stderr: any = null;
  private requestIdCounter: number = 1;
  private pendingRequests: Map<number, { resolve: (value: any) => void; reject: (error: any) => void; timer?: ReturnType<typeof setTimeout> }> = new Map();
  private eventListeners: Map<string, ((data: any) => void)[]> = new Map();
  private isClosed: boolean = false;
  /** True once the initialize handshake completed and notifications/initialized was sent. */
  private initialized: boolean = false;
  /** Protocol version agreed during initialize (lifecycle §Version Negotiation). */
  private negotiatedProtocolVersion: string | null = null;
  /** Server capabilities from the initialize result (lifecycle §Capability Negotiation). */
  private serverCapabilities: Record<string, any> | null = null;

  constructor(private config: McpServerConfig) {}

  private tauriClient: any = null;

  async connect(): Promise<void> {
    if (!this.config.command) {
      throw new Error('No command specified for stdio MCP server');
    }

    try {
      // The config stores a full command line (e.g. "npx -y @mcp/server-fs /path").
      // Split it into executable + args; the OS spawn needs them separated.
      const { bin, args: parsedArgs } = splitCommandLine(this.config.command);
      const allArgs = [...parsedArgs, ...(this.config.args ?? [])];

      // Use Tauri transport for real process management
      this.tauriClient = await TauriMcpStdioTransport.spawnProcess(
        bin,
        allArgs,
        this.config.env,
      );

      console.log(`[MCP] Connected via Tauri: ${this.config.command}`);

      // Start polling for responses BEFORE initialize so the response can arrive
      this.startResponsePolling();

      // Send initialization request (polling loop will deliver the response)
      await this.initialize();
    } catch (error) {
      console.error(`[MCP] Failed to connect via Tauri: ${error}`);
      // Lifecycle §Version Negotiation: on an unsupported version (or any
      // failed handshake) the client SHOULD disconnect — reap the spawned
      // child process instead of leaving a half-initialized connection.
      try { await this.disconnect(); } catch { /* best-effort cleanup */ }
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
            // Yield to the macrotask queue between reads. Without this the
            // loop can run as a pure microtask chain (read resolves →
            // continuation → read …), starving timers and any pending
            // disconnect — which manifested as unbounded allocation when a
            // reader kept returning data.
            await new Promise(resolve => setTimeout(resolve, 0));
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
              // JSON-RPC 2.0 error pass-through: preserve code + data
              // (tools §Error Handling "Protocol Errors"), not just message.
              pendingRequest.reject(new McpJsonRpcError(message.error.code, message.error.message, message.error.data));
            } else {
              pendingRequest.resolve(message.result);
            }
            if (pendingRequest.timer) clearTimeout(pendingRequest.timer);
            this.pendingRequests.delete(message.id);
          }
        }
        // Handle JSON-RPC notification
        else if ('method' in message) {
          const notification = message as McpNotification;
          this.emitEvent(notification.method, notification.params);
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
    for (const [, pending] of this.pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer);
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
      params: MCP_INITIALIZE_PARAMS,
    };

    const result = await this.sendRequest(request);

    // Lifecycle §Version Negotiation: accept the server's counter-offer when
    // supported, otherwise fail (connect() disconnects on throw).
    this.negotiatedProtocolVersion = negotiateProtocolVersion(result);
    this.serverCapabilities = result?.capabilities ?? null;

    // Lifecycle §Initialization: after a successful initialize response the
    // client MUST send notifications/initialized before normal operations.
    await this.sendNotification('notifications/initialized');
    this.initialized = true;
    return result;
  }

  /** Negotiated protocol version (null before initialize completes). */
  getNegotiatedProtocolVersion(): string | null {
    return this.negotiatedProtocolVersion;
  }

  /** Server capabilities from initialize (null before initialize completes). */
  getServerCapabilities(): Record<string, any> | null {
    return this.serverCapabilities;
  }

  async listTools(): Promise<McpTool[]> {
    // Lifecycle §Capability Negotiation / Operation: only use capabilities
    // that were successfully negotiated — a server that did not declare
    // `tools` must not be sent tools/list.
    if (this.serverCapabilities && !this.serverCapabilities.tools) {
      console.warn(`[MCP] Server ${this.config.name} did not declare the tools capability; skipping tools/list`);
      return [];
    }

    // server/utilities/pagination: follow nextCursor until exhausted.
    const all: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) { // hard cap guards against cursor loops
      const request: McpRequest = {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/list',
        ...(cursor !== undefined ? { params: { cursor } } : {}),
      };
      const result = await this.sendRequest(request);
      all.push(...normalizeToolsList(result));
      cursor = typeof result?.nextCursor === 'string' && result.nextCursor !== '' ? result.nextCursor : undefined;
      if (cursor === undefined) break;
    }
    return all;
  }

  /**
   * tools/call. Returns the raw result object; a result with `isError: true`
   * is a *tool execution* error (server/tools §Error Handling) and resolves
   * normally — only JSON-RPC protocol errors reject.
   */
  async callTool(toolName: string, params: any): Promise<any> {
    const request: McpRequest = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params,
      }
    };

    return this.sendRequest(request);
  }

  /** Fire-and-forget JSON-RPC notification (no id, no pending request). */
  private async sendNotification(method: string, params?: any): Promise<void> {
    if (this.isClosed || !this.tauriClient) return;
    const notification: McpNotification = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
    try {
      await TauriMcpStdioTransport.sendRequest(this.tauriClient, JSON.stringify(notification));
    } catch (e) {
      console.error(`[MCP] Failed to send notification ${method}: ${e}`);
    }
  }

  private async sendRequest(request: McpRequest): Promise<any> {
    if (this.isClosed) {
      throw new Error('MCP connection is closed');
    }

    if (!this.tauriClient) {
      throw new Error('MCP Tauri client not initialized');
    }

    // Lifecycle §Initialization: the client SHOULD NOT send requests other
    // than pings before the server has responded to initialize.
    if (!this.initialized && request.method !== 'initialize' && request.method !== 'ping') {
      throw new Error(`MCP request ${request.method} attempted before initialize handshake completed`);
    }

    const timeoutMs = this.config.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const requestId = request.id != null ? request.id : this.getNextRequestId();

      // Per-request timeout (#446): if the server doesn't respond within
      // timeoutMs, reject so the agentic loop isn't blocked forever.
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`MCP request timed out after ${timeoutMs}ms (method: ${request.method})`));
        }
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      // Set the ID on the request
      request.id = requestId;
      
      const jsonString = JSON.stringify(request);
      
      // Use Tauri transport to send the request
      TauriMcpStdioTransport.sendRequest(this.tauriClient, jsonString)
        .then(() => {
          // Request sent successfully, wait for response in polling
        })
        .catch(error => {
          clearTimeout(timer);
          this.pendingRequests.delete(requestId);
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
    for (const [, pending] of this.pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer);
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
  constructor(private config: McpServerConfig) {}

  /**
   * Connect = run the full initialize handshake through the Streamable HTTP
   * transport (lifecycle §Initialization): spec-shaped initialize params
   * (protocolVersion + capabilities + clientInfo), version negotiation,
   * Mcp-Session-Id capture, then notifications/initialized. The previous
   * implementation posted a non-spec `{capabilities:{tool_calls:true}}` probe
   * via raw fetch and never completed the handshake.
   */
  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new Error('No URL specified for HTTP MCP server');
    }

    try {
      await McpHttpTransport.initializeSession(this.config);
      await McpHttpTransport.initialize(this.config.id);
      console.log(`[MCP HTTP] Connected to ${this.config.name}`);
    } catch (error) {
      console.error(`[MCP HTTP] Connection failed: ${error}`);
      // Drop the half-open session so a retry re-negotiates from scratch.
      McpHttpTransport.closeSession(this.config.id);
      if (error instanceof McpReauthRequiredError) throw error; // keep typed re-auth signal
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to HTTP MCP server: ${detail}`);
    }
  }

  async initialize(): Promise<any> {
    await McpHttpTransport.initializeSession(this.config);
    return McpHttpTransport.initialize(this.config.id);
  }

  async listTools(): Promise<McpTool[]> {
    this.checkRate();
    await McpHttpTransport.initializeSession(this.config);
    // Pagination + tools-capability gating live in the transport.
    return McpHttpTransport.listTools(this.config.id);
  }

  /**
   * tools/call. Returns the raw result object; a result with `isError: true`
   * is a *tool execution* error (server/tools §Error Handling) and resolves
   * normally — only JSON-RPC protocol errors reject.
   */
  async callTool(toolName: string, params: any): Promise<any> {
    this.checkRate();
    await McpHttpTransport.initializeSession(this.config);
    return McpHttpTransport.callTool(this.config.id, toolName, params);
  }

  /** Guard against runaway request storms to a single MCP endpoint (#35). */
  private checkRate(): void {
    const limit = checkRateLimit(`mcp-http:${this.config.id}`, 'mcp-http');
    if (!limit.allowed) {
      throw new Error(`MCP request rate limit reached — retry in ${Math.ceil(limit.retryAfterMs / 1000)}s.`);
    }
  }

  async disconnect(): Promise<void> {
    // Transports §Session Management: clients that no longer need a session
    // SHOULD send an HTTP DELETE with the Mcp-Session-Id (best-effort; servers
    // MAY answer 405).
    await McpHttpTransport.terminateSession(this.config.id);
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

  async removeServer(id: string): Promise<void> {
    // Disconnect (awaited) so the stdio child process is reaped before we forget it (#54).
    if (this.activeConnections.has(id)) {
      try { await this.activeConnections.get(id)?.disconnect(); } catch { /* ignore */ }
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

  async disconnectFromServer(id: string): Promise<void> {
    const connection = this.activeConnections.get(id);
    if (connection) {
      try { await connection.disconnect(); } catch { /* ignore */ }
      this.activeConnections.delete(id);
    }
  }

  /** Active connection ids (used by the shutdown handler and UI). */
  getActiveConnectionIds(): string[] {
    return Array.from(this.activeConnections.keys());
  }

  /**
   * Gracefully disconnect every active connection (#54). Called on app close so
   * spawned stdio child processes are terminated instead of leaking.
   */
  async disconnectAll(): Promise<void> {
    const ids = this.getActiveConnectionIds();
    await Promise.allSettled(ids.map(async (id) => {
      const c = this.activeConnections.get(id);
      this.activeConnections.delete(id);
      if (c) { try { await c.disconnect(); } catch { /* ignore */ } }
    }));
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

// ---------------------------------------------------------------------------
// Graceful shutdown (#54)
// ---------------------------------------------------------------------------

let _shutdownRegistered = false;

/**
 * Register a window 'beforeunload' handler that disconnects all active MCP
 * connections when the app closes, terminating spawned stdio child processes.
 * Idempotent and a no-op outside a browser/Tauri window (e.g. tests).
 */
export function registerMcpShutdownHandler(manager: McpServerManager = mcpServerManager): void {
  if (_shutdownRegistered) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  _shutdownRegistered = true;
  window.addEventListener('beforeunload', () => {
    void manager.disconnectAll();
  });
}

/** Test helper: allow re-registration. */
export function _resetShutdownHandler(): void {
  _shutdownRegistered = false;
}
