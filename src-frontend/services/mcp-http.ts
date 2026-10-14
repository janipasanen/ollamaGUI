// MCP Streamable HTTP Transport
// Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
async function invoke(cmd: string, args: any): Promise<any> {
  try {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return await tauriInvoke(cmd, args);
  } catch {
    // Outside Tauri (browser dev / tests), perform the HTTP request for real
    // with fetch instead of faking a successful handshake: a fake success made
    // connection errors unrepresentable — an unreachable server showed green.
    if (cmd === 'mcp_http_request') {
      const req = args?.request ?? {};
      try {
        const res = await fetch(req.url, {
          method: req.method ?? 'POST',
          headers: req.headers ?? {},
          ...(req.body !== undefined && req.method !== 'GET' && req.method !== 'DELETE' ? { body: req.body } : {}),
        });
        const headers: Record<string, string> = {};
        res.headers?.forEach?.((v: string, k: string) => { headers[k.toLowerCase()] = v; });
        return {
          success: res.ok,
          status: res.status,
          headers,
          body: await res.text(),
          ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
        };
      } catch (e) {
        return { success: false, status: 0, headers: {}, body: '', error: e instanceof Error ? e.message : 'fetch failed' };
      }
    }
    return { success: false, error: 'Tauri not available' };
  }
}

import {
  McpServerConfig,
  McpTool,
  McpRequest,
  McpResponse,
  MCP_INITIALIZE_PARAMS,
  McpJsonRpcError,
  negotiateProtocolVersion,
  normalizeToolsList,
} from './mcp';
import { getValidAccessToken } from './mcpAuth';

/** Thrown when an HTTP MCP server returns 401, so the UI can prompt re-authentication. */
export class McpReauthRequiredError extends Error {
  constructor(public sessionId: string) {
    super(`MCP server ${sessionId} requires (re-)authentication`);
    this.name = 'McpReauthRequiredError';
  }
}

/** Shape of the Rust `mcp_http_request` command's response. */
interface McpHttpInvokeResponse {
  success: boolean;
  status: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

/** Case-insensitive HTTP header lookup (reqwest lowercases, mocks may not). */
function headerLookup(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/**
 * Parse a complete SSE body (transports §Sending Messages to the Server #5-6:
 * a POSTed JSON-RPC request may be answered with Content-Type
 * text/event-stream carrying one or more JSON-RPC messages as `data:` events).
 * Returns every JSON-parsable message in stream order.
 */
export function parseSseMessages(body: string): any[] {
  const messages: any[] = [];
  // Events are separated by a blank line (SSE spec); tolerate \r\n.
  for (const rawEvent of body.split(/\r?\n\r?\n/)) {
    const dataLines = rawEvent
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    try {
      messages.push(JSON.parse(dataLines.join('\n')));
    } catch { /* non-JSON event (e.g. keep-alive comment payload) — skip */ }
  }
  return messages;
}

/**
 * Extract a human-readable error detail from a non-ok MCP HTTP response body
 * (#461). MCP servers speak JSON-RPC, so errors may arrive as
 * `{"error":{"message":"…"}}` even on non-ok HTTP status codes. Falls back to
 * the provided default when the body is absent, non-JSON, or has no error field.
 */
export function httpBodyErrorDetail(body: string | undefined, fallback: string): string {
  if (!body) return fallback;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) {
      if (typeof parsed.error === 'string') return parsed.error;
      if (typeof parsed.error.message === 'string') return parsed.error.message;
    }
    if (typeof parsed?.message === 'string') return parsed.message;
  } catch { /* not JSON — keep fallback */ }
  return fallback;
}

interface McpHttpSession {
  url: string;
  authToken?: string;
  extraHeaders?: Record<string, string>;
  eventListeners: Map<string, ((data: any) => void)[]>;
  /** Monotonic JSON-RPC request id (JSON-RPC 2.0: ids must be unique per session). */
  requestIdCounter: number;
  /** Server-assigned session id (transports §Session Management). */
  mcpSessionId?: string;
  /** Version agreed at initialize (lifecycle §Version Negotiation). */
  protocolVersion?: string;
  /** Server capabilities from initialize (lifecycle §Capability Negotiation). */
  serverCapabilities?: Record<string, any>;
  /** True once initialize + notifications/initialized completed. */
  initialized: boolean;
  /** De-dupes concurrent initialize attempts. */
  initPromise?: Promise<any>;
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

  private static sessions: Map<string, McpHttpSession> = new Map();

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
      requestIdCounter: 1,
      initialized: false,
    });
  }

  private static nextRequestId(session: McpHttpSession): number {
    return session.requestIdCounter++;
  }

  /**
   * Build the headers for one HTTP message. Transports:
   * - §Sending Messages #2: Accept MUST list application/json AND text/event-stream.
   * - §Protocol Version Header: MCP-Protocol-Version MUST be sent on every
   *   request after initialize, carrying the negotiated version.
   * - §Session Management #2: Mcp-Session-Id MUST be echoed on all subsequent
   *   requests once the server assigned one at initialization.
   */
  private static buildHeaders(session: McpHttpSession, authToken?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(session.protocolVersion ? { 'MCP-Protocol-Version': session.protocolVersion } : {}),
      ...(session.mcpSessionId ? { 'Mcp-Session-Id': session.mcpSessionId } : {}),
      ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      ...(session.extraHeaders ?? {}),
    };
  }

  /** POST one JSON-RPC message; returns the raw HTTP response (status/headers/body). */
  private static async post(
    sessionId: string,
    session: McpHttpSession,
    body: string,
    httpMethod: string = 'POST'
  ): Promise<McpHttpInvokeResponse> {
    const authToken = await this.resolveAuthToken(sessionId, session.authToken);
    const callInvoke = McpHttpTransport._mockInvoke ?? invoke;
    const response = await callInvoke('mcp_http_request', {
      request: {
        sessionId,
        url: session.url,
        method: httpMethod,
        headers: this.buildHeaders(session, authToken),
        body,
        authToken,
      },
    });
    return response as McpHttpInvokeResponse;
  }

  /**
   * Interpret the HTTP response to a POSTed JSON-RPC *request*
   * (transports §Sending Messages #5-6): the server returns either a single
   * application/json object or a text/event-stream that eventually carries the
   * response; the client MUST support both. Server notifications interleaved
   * on the stream are emitted to listeners.
   */
  private static extractJsonRpcResponse(
    sessionId: string,
    http: McpHttpInvokeResponse,
    requestId: number | string
  ): McpResponse {
    const contentType = headerLookup(http.headers, 'content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      let response: McpResponse | null = null;
      for (const message of parseSseMessages(http.body)) {
        if (message && message.id != null && ('result' in message || 'error' in message)) {
          if (message.id === requestId) response = message as McpResponse;
        } else if (message && typeof message.method === 'string') {
          // Interleaved server notification/request on the stream — surface to listeners.
          this.emit(sessionId, message.method, message.params);
        }
      }
      if (!response) {
        throw new Error(`SSE stream ended without a response for request ${requestId}`);
      }
      return response;
    }
    return JSON.parse(http.body) as McpResponse;
  }

  static async sendRequest(
    sessionId: string,
    request: McpRequest,
    /** internal: prevents infinite re-init recursion on repeated 404s */
    isRetry: boolean = false
  ): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Lifecycle §Initialization: initialization MUST be the first interaction —
    // run the handshake before any other request on this session.
    if (!session.initialized && request.method !== 'initialize' && request.method !== 'ping') {
      await this.initialize(sessionId);
    }

    try {
      const httpResponse = await this.post(sessionId, session, JSON.stringify(request));

      // 401 → the token is invalid/expired and couldn't be refreshed; prompt re-auth.
      if (httpResponse.status === 401) {
        throw new McpReauthRequiredError(sessionId);
      }

      // Transports §Session Management #4: on 404 for a request carrying an
      // Mcp-Session-Id the client MUST start a new session with a fresh
      // InitializeRequest, then we retry the original request once.
      if (httpResponse.status === 404 && session.mcpSessionId && !isRetry) {
        session.mcpSessionId = undefined;
        session.initialized = false;
        session.protocolVersion = undefined;
        await this.initialize(sessionId);
        return this.sendRequest(sessionId, request, true);
      }

      if (!httpResponse.success) {
        throw new Error(httpBodyErrorDetail(
          httpResponse.body,
          httpResponse.error || `HTTP request failed with status ${httpResponse.status}`
        ));
      }

      const parsedResponse = this.extractJsonRpcResponse(sessionId, httpResponse, request.id ?? null as any);

      if (parsedResponse.error) {
        // JSON-RPC 2.0 error pass-through: keep code + data (tools §Error
        // Handling "Protocol Errors"), not just the message string.
        throw new McpJsonRpcError(parsedResponse.error.code, parsedResponse.error.message, parsedResponse.error.data);
      }

      return parsedResponse.result;
    } catch (error) {
      if (error instanceof McpReauthRequiredError) throw error; // surface typed re-auth signal as-is
      console.error(`[MCP HTTP] Request failed: ${error}`);
      if (error instanceof McpJsonRpcError) throw error; // JSON-RPC errors pass through unwrapped
      throw new Error(`MCP HTTP request failed: ${error}`);
    }
  }

  /**
   * Full initialize handshake (lifecycle §Initialization):
   * 1. POST initialize with protocolVersion + capabilities + clientInfo.
   * 2. Negotiate the protocol version (accept the server's counter-offer when
   *    supported; fail — and drop the session — otherwise).
   * 3. Capture the Mcp-Session-Id response header if the server assigned one
   *    (transports §Session Management #1-2).
   * 4. Send notifications/initialized before any other request.
   */
  static async initialize(sessionId: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (session.initPromise) return session.initPromise; // de-dupe concurrent handshakes

    const doInit = async (): Promise<any> => {
      const request: McpRequest = {
        jsonrpc: '2.0',
        id: this.nextRequestId(session),
        method: 'initialize',
        params: MCP_INITIALIZE_PARAMS,
      };

      const httpResponse = await this.post(sessionId, session, JSON.stringify(request));

      if (httpResponse.status === 401) {
        throw new McpReauthRequiredError(sessionId);
      }
      if (!httpResponse.success) {
        throw new Error(httpBodyErrorDetail(
          httpResponse.body,
          httpResponse.error || `HTTP request failed with status ${httpResponse.status}`
        ));
      }

      const parsed = this.extractJsonRpcResponse(sessionId, httpResponse, request.id!);
      if (parsed.error) {
        throw new McpJsonRpcError(parsed.error.code, parsed.error.message, parsed.error.data);
      }

      // Lifecycle §Version Negotiation: unsupported counter-offer → disconnect.
      session.protocolVersion = negotiateProtocolVersion(parsed.result);
      session.serverCapabilities = parsed.result?.capabilities ?? undefined;

      // Transports §Session Management #1: session id is assigned via the
      // Mcp-Session-Id header on the InitializeResult response.
      const assignedSessionId = headerLookup(httpResponse.headers, 'mcp-session-id');
      if (assignedSessionId) session.mcpSessionId = assignedSessionId;

      // Lifecycle: MUST send notifications/initialized after the response and
      // before normal operations (server answers 202 Accepted, no body).
      await this.sendNotification(sessionId, 'notifications/initialized');
      session.initialized = true;
      return parsed.result;
    };

    session.initPromise = doInit();
    try {
      return await session.initPromise;
    } catch (error) {
      // Failed handshake → forget negotiated state so a retry starts clean.
      session.initialized = false;
      session.protocolVersion = undefined;
      session.mcpSessionId = undefined;
      throw error;
    } finally {
      session.initPromise = undefined;
    }
  }

  static async listTools(sessionId: string): Promise<McpTool[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (!session.initialized) await this.initialize(sessionId);

    // Lifecycle §Capability Negotiation / Operation: only use capabilities the
    // server declared — no tools capability means tools/list must not be sent.
    if (session.serverCapabilities && !session.serverCapabilities.tools) {
      console.warn(`[MCP HTTP] Server ${sessionId} did not declare the tools capability; skipping tools/list`);
      return [];
    }

    // server/utilities/pagination: follow nextCursor until exhausted.
    const all: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) { // hard cap guards against cursor loops
      const request: McpRequest = {
        jsonrpc: '2.0',
        id: this.nextRequestId(session),
        method: 'tools/list',
        ...(cursor !== undefined ? { params: { cursor } } : {}),
      };
      const result = await this.sendRequest(sessionId, request);
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
  static async callTool(
    sessionId: string,
    toolName: string,
    params: any
  ): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    const request: McpRequest = {
      jsonrpc: '2.0',
      id: this.nextRequestId(session),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params,
      },
    };

    return this.sendRequest(sessionId, request);
  }

  /**
   * Fire-and-forget JSON-RPC notification over HTTP (no id). Transports
   * §Sending Messages #4: the server answers an accepted notification with
   * 202 Accepted and no body — there is no JSON-RPC response to consume.
   */
  static async sendNotification(sessionId: string, method: string, params?: any): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const body = JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
    try {
      await this.post(sessionId, session, body);
    } catch (e) {
      console.error(`[MCP HTTP] Failed to send notification ${method}: ${e}`);
    }
  }

  /**
   * Explicitly terminate the server-side session with HTTP DELETE + the
   * Mcp-Session-Id header (transports §Session Management #5). Best-effort:
   * servers MAY respond 405 Method Not Allowed. Always drops local state.
   */
  static async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.mcpSessionId) {
      try {
        await this.post(sessionId, session, '', 'DELETE');
      } catch { /* best-effort — 405 or network errors are fine */ }
    }
    this.closeSession(sessionId);
  }

  /** Negotiated protocol version for a session (undefined before initialize). */
  static getNegotiatedProtocolVersion(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.protocolVersion;
  }

  /** Server-assigned Mcp-Session-Id (undefined when the server is stateless). */
  static getMcpSessionId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.mcpSessionId;
  }

  /** Server capabilities from initialize (undefined before initialize). */
  static getServerCapabilities(sessionId: string): Record<string, any> | undefined {
    return this.sessions.get(sessionId)?.serverCapabilities;
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
