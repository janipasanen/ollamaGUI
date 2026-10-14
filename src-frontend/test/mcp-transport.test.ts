import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mcpServerManager, McpStdioClient, McpHttpClient, McpJsonRpcError } from '../services/mcp';
import type { McpServerConfig, McpRequest } from '../services/mcp';
import { McpHttpTransport, parseSseMessages } from '../services/mcp-http';
import { TauriMcpStdioTransport } from '../services/mcp-tauri';

describe('MCP Transport Tests', () => {
  beforeEach(() => {
    // Clear any existing servers and connections
    const servers = mcpServerManager.getAllServers();
    servers.forEach(server => mcpServerManager.removeServer(server.id));
    // Reset HTTP transport state
    McpHttpTransport._mockInvoke = null;
    McpHttpTransport.clearSessions();
    TauriMcpStdioTransport._mockInvoke = null;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    const servers = mcpServerManager.getAllServers();
    servers.forEach(server => mcpServerManager.disconnectFromServer(server.id));
    McpHttpTransport._mockInvoke = null;
    TauriMcpStdioTransport._mockInvoke = null;
  });

  describe('MCP Stdio Transport', () => {
    it('should create and manage stdio server configurations', () => {
      const config: McpServerConfig = {
        id: 'test-stdio',
        name: 'Test Stdio Server',
        type: 'stdio',
        command: 'echo',
        enabled: true,
        toolsEnabled: true,
      };

      mcpServerManager.addServer(config);
      const retrieved = mcpServerManager.getServer('test-stdio');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test Stdio Server');
      expect(retrieved?.type).toBe('stdio');
      expect(retrieved?.command).toBe('echo');
    });

    it('should handle stdio client initialization', async () => {
      const config: McpServerConfig = {
        id: 'test-stdio',
        name: 'Test Stdio Server',
        type: 'stdio',
        command: 'echo',
        enabled: true,
        toolsEnabled: true,
      };

      mcpServerManager.addServer(config);

      // Mock ALL transport methods BEFORE connecting (polling loop starts before initialize)
      const mockSpawn = vi.spyOn(TauriMcpStdioTransport, 'spawnProcess');
      mockSpawn.mockResolvedValue({ sessionId: 'test-session', command: 'echo', args: [] });

      const mockSend = vi.spyOn(TauriMcpStdioTransport, 'sendRequest');
      mockSend.mockResolvedValue(undefined);

      // readResponse returns the initialize response (id matches what sendRequest registers)
      const mockRead = vi.spyOn(TauriMcpStdioTransport, 'readResponse');
      mockRead.mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"s","version":"1"}}}');

      const client = await mcpServerManager.connectToServer('test-stdio');

      expect(client).toBeInstanceOf(McpStdioClient);
      expect(mockSpawn).toHaveBeenCalled();
    });

    it('should split the command line and pass env to the spawn', async () => {
      const config: McpServerConfig = {
        id: 'env-stdio',
        name: 'Env Stdio Server',
        type: 'stdio',
        command: 'npx -y @modelcontextprotocol/server-github',
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test' },
        enabled: true,
        toolsEnabled: true,
      } as McpServerConfig;

      mcpServerManager.addServer(config);

      const mockSpawn = vi.spyOn(TauriMcpStdioTransport, 'spawnProcess');
      mockSpawn.mockResolvedValue({ sessionId: 'env-session', command: 'npx', args: [] });
      vi.spyOn(TauriMcpStdioTransport, 'sendRequest').mockResolvedValue(undefined);
      vi.spyOn(TauriMcpStdioTransport, 'readResponse')
        .mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}');

      await mcpServerManager.connectToServer('env-stdio');

      // bin/args split out of the command line; env forwarded verbatim
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['-y', '@modelcontextprotocol/server-github'],
        { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test' },
      );
    });

    it('should handle stdio request sending', async () => {
      const config: McpServerConfig = {
        id: 'test-stdio',
        name: 'Test Stdio Server',
        type: 'stdio',
        command: 'echo',
        enabled: true,
        toolsEnabled: true,
      };

      mcpServerManager.addServer(config);

      const mockSpawn = vi.spyOn(TauriMcpStdioTransport, 'spawnProcess');
      mockSpawn.mockResolvedValue({ sessionId: 'test-session', command: 'echo', args: [] });

      const mockSend = vi.spyOn(TauriMcpStdioTransport, 'sendRequest');
      mockSend.mockResolvedValue(undefined);

      // Return responses for both initialize (id=1) and any subsequent requests (id=2)
      let readCount = 0;
      const mockRead = vi.spyOn(TauriMcpStdioTransport, 'readResponse');
      mockRead.mockImplementation(async () => {
        readCount++;
        if (readCount === 1) return '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}}}}';
        if (readCount === 2) return '{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}';
        return null;
      });

      const client = await mcpServerManager.connectToServer('test-stdio') as McpStdioClient;
      expect(client).toBeInstanceOf(McpStdioClient);
      expect(mockSend).toHaveBeenCalled();
    });

    it('should timeout when stdio server never responds (#446)', async () => {
      const config: McpServerConfig = {
        id: 'timeout-stdio',
        name: 'Timeout Stdio Server',
        type: 'stdio',
        command: 'echo',
        enabled: true,
        toolsEnabled: true,
        timeoutMs: 100, // 100ms timeout for fast test
      };

      mcpServerManager.addServer(config);

      vi.spyOn(TauriMcpStdioTransport, 'spawnProcess')
        .mockResolvedValue({ sessionId: 'timeout-session', command: 'echo', args: [] });
      vi.spyOn(TauriMcpStdioTransport, 'sendRequest').mockResolvedValue(undefined);

      // readResponse returns only the initialize response, then null forever
      // so the tools/call request (id=2) never gets a response.
      let readCount = 0;
      vi.spyOn(TauriMcpStdioTransport, 'readResponse').mockImplementation(async () => {
        readCount++;
        if (readCount === 1) return '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}';
        return null;
      });

      const client = await mcpServerManager.connectToServer('timeout-stdio') as McpStdioClient;
      expect(client).toBeInstanceOf(McpStdioClient);

      // callTool internally calls sendRequest which should timeout after 100ms
      await expect(client.callTool('some_tool', {}))
        .rejects.toThrow(/timed out after 100ms/);
    });

    it('should clear timeout when stdio server responds normally (#446)', async () => {
      const config: McpServerConfig = {
        id: 'normal-stdio',
        name: 'Normal Stdio Server',
        type: 'stdio',
        command: 'echo',
        enabled: true,
        toolsEnabled: true,
        timeoutMs: 5000,
      };

      mcpServerManager.addServer(config);

      vi.spyOn(TauriMcpStdioTransport, 'spawnProcess')
        .mockResolvedValue({ sessionId: 'normal-session', command: 'echo', args: [] });
      vi.spyOn(TauriMcpStdioTransport, 'sendRequest').mockResolvedValue(undefined);

      let readCount = 0;
      vi.spyOn(TauriMcpStdioTransport, 'readResponse').mockImplementation(async () => {
        readCount++;
        if (readCount === 1) return '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}';
        // Return the id=2 response on every subsequent poll so it's available
        // whenever the callTool request is registered (the polling loop may
        // consume earlier returns before the request is sent).
        return '{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"ok"}]}}';
      });

      const client = await mcpServerManager.connectToServer('normal-stdio') as McpStdioClient;
      const result = await client.callTool('some_tool', {});
      expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    });

    it('should handle stdio process cleanup', async () => {
      const config: McpServerConfig = {
        id: 'test-stdio',
        name: 'Test Stdio Server',
        type: 'stdio',
        command: 'echo',
        enabled: true,
        toolsEnabled: true,
      };

      mcpServerManager.addServer(config);

      const mockSpawn = vi.spyOn(TauriMcpStdioTransport, 'spawnProcess');
      mockSpawn.mockResolvedValue({ sessionId: 'test-session', command: 'echo', args: [] });

      const mockSend = vi.spyOn(TauriMcpStdioTransport, 'sendRequest');
      mockSend.mockResolvedValue(undefined);

      const mockClose = vi.spyOn(TauriMcpStdioTransport, 'closeProcess');
      mockClose.mockResolvedValue(undefined);

      const mockRead = vi.spyOn(TauriMcpStdioTransport, 'readResponse');
      mockRead.mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}');

      const client = await mcpServerManager.connectToServer('test-stdio');
      await client.disconnect();

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('MCP HTTP Transport', () => {
    it('should create and manage HTTP server configurations', () => {
      const config: McpServerConfig = {
        id: 'test-http',
        name: 'Test HTTP Server',
        type: 'http',
        url: 'http://localhost:8080',
        enabled: true,
        toolsEnabled: true,
        auth: {
          token: 'test-token',
          type: 'bearer',
        },
      };

      mcpServerManager.addServer(config);
      const retrieved = mcpServerManager.getServer('test-http');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test HTTP Server');
      expect(retrieved?.type).toBe('http');
      expect(retrieved?.url).toBe('http://localhost:8080');
      expect(retrieved?.auth?.token).toBe('test-token');
    });

    it('should initialize HTTP transport session', async () => {
      const config: McpServerConfig = {
        id: 'test-http',
        name: 'Test HTTP Server',
        type: 'http',
        url: 'http://localhost:8080',
        enabled: true,
        toolsEnabled: true,
      };

      await McpHttpTransport.initializeSession(config);
      expect(McpHttpTransport.isConnected('test-http')).toBe(true);
    });

    it('should send HTTP requests with proper headers', async () => {
      const config: McpServerConfig = {
        id: 'test-http',
        name: 'Test HTTP Server',
        type: 'http',
        url: 'http://localhost:8080',
        enabled: true,
        toolsEnabled: true,
        auth: { token: 'test-token', type: 'bearer' },
      };

      const mockInvoke = vi.fn().mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"result":{"version":"1.0"}}',
      });

      McpHttpTransport._mockInvoke = mockInvoke;
      try {
        await McpHttpTransport.initializeSession(config);

        const request: McpRequest = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
        const result = await McpHttpTransport.sendRequest('test-http', request);

        expect(result).toEqual({ version: '1.0' });
        expect(mockInvoke).toHaveBeenCalled();
        const callArgs = mockInvoke.mock.calls[0][1];
        expect(callArgs.request.headers.Authorization).toContain('Bearer test-token');
      } finally {
        McpHttpTransport._mockInvoke = null;
      }
    });

    it('should handle HTTP request errors', async () => {
      const config: McpServerConfig = {
        id: 'test-http',
        name: 'Test HTTP Server',
        type: 'http',
        url: 'http://localhost:8080',
        enabled: true,
        toolsEnabled: true,
      };

      const mockInvoke = vi.fn().mockResolvedValue({
        success: false,
        status: 500,
        headers: {},
        body: 'Internal Server Error',
        error: 'Server error',
      });

      McpHttpTransport._mockInvoke = mockInvoke;
      try {
        await McpHttpTransport.initializeSession(config);
        const request: McpRequest = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };

        await expect(McpHttpTransport.sendRequest('test-http', request))
          .rejects
          .toThrow('MCP HTTP request failed');
      } finally {
        McpHttpTransport._mockInvoke = null;
      }
    });

    it('should handle MCP protocol errors', async () => {
      const config: McpServerConfig = {
        id: 'test-http',
        name: 'Test HTTP Server',
        type: 'http',
        url: 'http://localhost:8080',
        enabled: true,
        toolsEnabled: true,
      };

      const mockInvoke = vi.fn().mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}',
      });

      McpHttpTransport._mockInvoke = mockInvoke;
      try {
        await McpHttpTransport.initializeSession(config);
        const request: McpRequest = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };

        await expect(McpHttpTransport.sendRequest('test-http', request))
          .rejects
          .toThrow('Method not found');
      } finally {
        McpHttpTransport._mockInvoke = null;
      }
    });

    it('should close HTTP sessions properly', async () => {
      const config: McpServerConfig = {
        id: 'test-http',
        name: 'Test HTTP Server',
        type: 'http',
        url: 'http://localhost:8080',
        enabled: true,
        toolsEnabled: true,
      };

      await McpHttpTransport.initializeSession(config);
      expect(McpHttpTransport.isConnected('test-http')).toBe(true);

      McpHttpTransport.closeSession('test-http');
      expect(McpHttpTransport.isConnected('test-http')).toBe(false);
    });
  });

  describe('Server Manager Integration', () => {
    it('should connect to both stdio and HTTP servers', async () => {
      // Add stdio server
      const stdioConfig: McpServerConfig = {
        id: 'stdio-server',
        name: 'Stdio Server',
        type: 'stdio',
        command: 'echo',
        enabled: true,
        toolsEnabled: true,
      };

      // Add HTTP server
      const httpConfig: McpServerConfig = {
        id: 'http-server',
        name: 'HTTP Server',
        type: 'http',
        url: 'http://localhost:8080',
        enabled: true,
        toolsEnabled: true,
      };

      mcpServerManager.addServer(stdioConfig);
      mcpServerManager.addServer(httpConfig);

      const allServers = mcpServerManager.getAllServers();
      expect(allServers).toHaveLength(2);
      expect(allServers[0].type).toBe('stdio');
      expect(allServers[1].type).toBe('http');
    });

    it('should discover tools from connected servers', async () => {
      const config: McpServerConfig = {
        id: 'test-server',
        name: 'Test Server',
        type: 'http',
        url: 'http://localhost:8080',
        enabled: true,
        toolsEnabled: true,
      };

      mcpServerManager.addServer(config);

      // McpHttpClient.connect() now runs the full initialize handshake through
      // the transport (_mockInvoke seam) — answer by method.
      McpHttpTransport._mockInvoke = vi.fn().mockImplementation(async (_cmd, args) => {
        const req = JSON.parse(args.request.body);
        const result = req.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 's', version: '1' } }
          : { tools: [{ name: 'test_tool', description: 'A test tool', inputSchema: { type: 'object', properties: {} } }] };
        return {
          success: true, status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: req.id ?? 1, result }),
        };
      });

      try {
        const tools = await mcpServerManager.discoverTools('test-server');
        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBeGreaterThan(0);
        expect(tools[0].name).toBe('test_tool');
      } finally {
        McpHttpTransport._mockInvoke = null;
      }
    });

    it('should handle server removal and cleanup', () => {
      const config: McpServerConfig = {
        id: 'test-server',
        name: 'Test Server',
        type: 'stdio',
        command: 'echo',
        enabled: true,
        toolsEnabled: true,
      };

      mcpServerManager.addServer(config);
      expect(mcpServerManager.getServer('test-server')).toBeDefined();

      mcpServerManager.removeServer('test-server');
      expect(mcpServerManager.getServer('test-server')).toBeUndefined();
    });
  });

  describe('MCP protocol compliance (#106)', () => {
    it('stdio: initialize sends protocolVersion + clientInfo and a notifications/initialized', async () => {
      const sent: any[] = [];
      // Drive the whole stdio transport through the mock seam.
      TauriMcpStdioTransport._mockInvoke = async (cmd, args) => {
        if (cmd === 'mcp_stdio_spawn') return { success: true, session_id: args.sessionId };
        if (cmd === 'mcp_stdio_send') {
          const msg = JSON.parse(args.request);
          sent.push(msg);
          return { success: true };
        }
        if (cmd === 'mcp_stdio_read') {
          // Respond to the most recent id-bearing request.
          const lastReq = [...sent].reverse().find(m => m.id != null);
          if (!lastReq || lastReq._answered) return null;
          lastReq._answered = true;
          const result = lastReq.method === 'initialize'
            ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 's', version: '1' } }
            : { tools: [] };
          return JSON.stringify({ jsonrpc: '2.0', id: lastReq.id, result });
        }
        if (cmd === 'mcp_stdio_close') return { success: true };
        return { success: false };
      };

      mcpServerManager.addServer({
        id: 'proto-stdio', name: 'Proto', type: 'stdio', command: 'echo', enabled: true, toolsEnabled: true,
      } as McpServerConfig);
      await mcpServerManager.connectToServer('proto-stdio');

      const init = sent.find(m => m.method === 'initialize');
      expect(init).toBeDefined();
      expect(init.params.protocolVersion).toBe('2025-06-18');
      expect(init.params.clientInfo).toMatchObject({ name: expect.any(String) });
      expect(init.params.capabilities).toBeDefined();
      const note = sent.find(m => m.method === 'notifications/initialized');
      expect(note).toBeDefined();
      expect(note.id).toBeUndefined(); // notifications carry no id
    });

    it('stdio: tools/call uses { name, arguments } and tools/list unwraps result.tools', async () => {
      const sent: any[] = [];
      TauriMcpStdioTransport._mockInvoke = async (cmd, args) => {
        if (cmd === 'mcp_stdio_spawn') return { success: true, session_id: args.sessionId };
        if (cmd === 'mcp_stdio_send') { sent.push(JSON.parse(args.request)); return { success: true }; }
        if (cmd === 'mcp_stdio_read') {
          const lastReq = [...sent].reverse().find(m => m.id != null && !m._answered);
          if (!lastReq) return null;
          lastReq._answered = true;
          let result: any = {};
          if (lastReq.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} } };
          else if (lastReq.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'd', inputSchema: { type: 'object', properties: { msg: { type: 'string' } } } }] };
          else if (lastReq.method === 'tools/call') result = { content: [{ type: 'text', text: 'ok' }] };
          return JSON.stringify({ jsonrpc: '2.0', id: lastReq.id, result });
        }
        return { success: true };
      };

      const client = new McpStdioClient({
        id: 'proto2', name: 'P2', type: 'stdio', command: 'echo', enabled: true, toolsEnabled: true,
      } as McpServerConfig);
      await client.connect();

      const tools = await client.listTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools[0]).toMatchObject({ name: 'echo' });
      expect(tools[0].parameters).toMatchObject({ type: 'object' }); // inputSchema -> parameters

      await client.callTool('echo', { msg: 'hi' });
      const call = sent.find(m => m.method === 'tools/call');
      expect(call.params).toEqual({ name: 'echo', arguments: { msg: 'hi' } });
      expect(call.params.tool_name).toBeUndefined();

      await client.disconnect(); // stop the polling loop so it can't interfere with later tests
    });

    it('http: initialize is spec-shaped and callTool uses { name, arguments }', async () => {
      const bodies: any[] = [];
      McpHttpTransport._mockInvoke = async (_cmd, args) => {
        const req = JSON.parse(args.request.body);
        bodies.push(req);
        const result = req.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 's', version: '1' } }
          : req.method === 'tools/list' ? { tools: [] } : { content: [] };
        return { success: true, status: 200, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) };
      };
      const cfg = { id: 'h1', name: 'H', type: 'http', url: 'http://localhost:9', enabled: true, toolsEnabled: true } as McpServerConfig;
      await McpHttpTransport.initializeSession(cfg);
      await McpHttpTransport.initialize('h1');
      await McpHttpTransport.callTool('h1', 'do', { a: 1 });

      const init = bodies.find(b => b.method === 'initialize');
      expect(init.params.protocolVersion).toBe('2025-06-18');
      expect(init.params.clientInfo).toBeDefined();
      expect(bodies.some(b => b.method === 'notifications/initialized')).toBe(true);
      const call = bodies.find(b => b.method === 'tools/call');
      expect(call.params).toEqual({ name: 'do', arguments: { a: 1 } });
    });

    it('filesystem: a quoted spaced path survives tokenization to spawnProcess (#111)', async () => {
      const mockSpawn = vi.spyOn(TauriMcpStdioTransport, 'spawnProcess');
      mockSpawn.mockResolvedValue({ sessionId: 'fs', command: 'npx', args: [] });
      vi.spyOn(TauriMcpStdioTransport, 'sendRequest').mockResolvedValue(undefined);
      vi.spyOn(TauriMcpStdioTransport, 'readResponse')
        .mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}');

      mcpServerManager.addServer({
        id: 'fs', name: 'FS', type: 'stdio',
        command: 'npx -y @modelcontextprotocol/server-filesystem "/Users/me/My Project"',
        enabled: true, toolsEnabled: true,
      } as McpServerConfig);
      await mcpServerManager.connectToServer('fs');

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Project'],
        undefined,
      );
    });

    it('discoverTools returns an array (not the wrapper object)', async () => {
      const sent: any[] = [];
      TauriMcpStdioTransport._mockInvoke = async (cmd, args) => {
        if (cmd === 'mcp_stdio_spawn') return { success: true, session_id: args.sessionId };
        if (cmd === 'mcp_stdio_send') { sent.push(JSON.parse(args.request)); return { success: true }; }
        if (cmd === 'mcp_stdio_read') {
          const lastReq = [...sent].reverse().find(m => m.id != null && !m._answered);
          if (!lastReq) return null;
          lastReq._answered = true;
          const result = lastReq.method === 'tools/list'
            ? { tools: [{ name: 't', description: '', inputSchema: {} }] }
            : { protocolVersion: '2025-06-18', capabilities: { tools: {} } };
          return JSON.stringify({ jsonrpc: '2.0', id: lastReq.id, result });
        }
        return { success: true };
      };
      mcpServerManager.addServer({ id: 'disc', name: 'D', type: 'stdio', command: 'echo', enabled: true, toolsEnabled: true } as McpServerConfig);
      const tools = await mcpServerManager.discoverTools('disc');
      expect(Array.isArray(tools)).toBe(true);
      expect(tools[0]).toMatchObject({ name: 't' });
    });
  });

  // ── M13: GitHub / GitLab transport tests (#112) ───────────────────────────

  describe('M13: GitHub + GitLab (#112)', () => {
    it('http: PAT bearer token from config.auth.token sent in Authorization header', async () => {
      const headers: Record<string, string>[] = [];
      McpHttpTransport._mockInvoke = async (_cmd, args) => {
        headers.push(args.request.headers);
        const req = JSON.parse(args.request.body);
        return {
          success: true, status: 200, headers: {},
          body: JSON.stringify({ jsonrpc: '2.0', id: req.id ?? 1, result: { protocolVersion: '2025-06-18', capabilities: {} } }),
        };
      };
      const cfg = {
        id: 'gh-http', name: 'GitHub', type: 'http', url: 'https://api.githubcopilot.com/mcp/',
        auth: { token: 'ghp_test123', type: 'bearer' as const },
        enabled: true, toolsEnabled: true,
      } as McpServerConfig;
      await McpHttpTransport.initializeSession(cfg);
      await McpHttpTransport.initialize('gh-http');
      expect(headers.some(h => h.Authorization === 'Bearer ghp_test123')).toBe(true);
    });

    it('stdio: Docker variant env vars reach spawnProcess (#112)', async () => {
      const mockSpawn = vi.spyOn(TauriMcpStdioTransport, 'spawnProcess');
      mockSpawn.mockResolvedValue({ sessionId: 'gh-docker', command: 'docker', args: [] });
      vi.spyOn(TauriMcpStdioTransport, 'sendRequest').mockResolvedValue(undefined);
      vi.spyOn(TauriMcpStdioTransport, 'readResponse')
        .mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}');

      mcpServerManager.addServer({
        id: 'gh-docker', name: 'GitHub Docker', type: 'stdio',
        command: 'docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server',
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_dockertest' },
        enabled: true, toolsEnabled: true,
      } as McpServerConfig);
      await mcpServerManager.connectToServer('gh-docker');

      expect(mockSpawn).toHaveBeenCalledWith(
        'docker',
        ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'],
        { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_dockertest' },
      );
    });

    it('http: GitLab tool-name-prefix header forwarded on every request (#112)', async () => {
      const capturedHeaders: Record<string, string>[] = [];
      McpHttpTransport._mockInvoke = async (_cmd, args) => {
        capturedHeaders.push({ ...args.request.headers });
        const req = JSON.parse(args.request.body);
        return {
          success: true, status: 200, headers: {},
          body: JSON.stringify({ jsonrpc: '2.0', id: req.id ?? 1, result: { protocolVersion: '2025-06-18', capabilities: {} } }),
        };
      };
      const cfg = {
        id: 'gl-http', name: 'GitLab', type: 'http', url: 'https://gitlab.com/api/v4/mcp',
        headers: { 'X-Gitlab-Mcp-Server-Tool-Name-Prefix': 'gl_' },
        enabled: true, toolsEnabled: true,
      } as McpServerConfig;
      await McpHttpTransport.initializeSession(cfg);
      await McpHttpTransport.initialize('gl-http');
      expect(capturedHeaders.some(h => h['X-Gitlab-Mcp-Server-Tool-Name-Prefix'] === 'gl_')).toBe(true);
    });
  });

  // ── M13: Atlassian (#113) ─────────────────────────────────────────────────

  describe('M13: Atlassian (#113)', () => {
    it('stdio: Jira env vars (incl. Confluence optional) reach spawnProcess', async () => {
      const mockSpawn = vi.spyOn(TauriMcpStdioTransport, 'spawnProcess');
      mockSpawn.mockResolvedValue({ sessionId: 'jira-test', command: 'uvx', args: [] });
      vi.spyOn(TauriMcpStdioTransport, 'sendRequest').mockResolvedValue(undefined);
      vi.spyOn(TauriMcpStdioTransport, 'readResponse')
        .mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}');

      mcpServerManager.addServer({
        id: 'jira-test', name: 'Jira', type: 'stdio', command: 'uvx mcp-atlassian',
        env: {
          JIRA_URL: 'https://org.atlassian.net',
          JIRA_USERNAME: 'user@org.com',
          JIRA_API_TOKEN: 'jira-tok',
          CONFLUENCE_URL: 'https://org.atlassian.net/wiki',
          CONFLUENCE_USERNAME: 'user@org.com',
          CONFLUENCE_API_TOKEN: 'conf-tok',
        },
        enabled: true, toolsEnabled: true,
      } as McpServerConfig);
      await mcpServerManager.connectToServer('jira-test');

      expect(mockSpawn).toHaveBeenCalledWith(
        'uvx',
        ['mcp-atlassian'],
        expect.objectContaining({
          JIRA_URL: 'https://org.atlassian.net',
          JIRA_API_TOKEN: 'jira-tok',
          CONFLUENCE_API_TOKEN: 'conf-tok',
        }),
      );
    });

    it('http: Rovo 401 throws McpReauthRequiredError (#113)', async () => {
      McpHttpTransport._mockInvoke = async () => ({
        success: false, status: 401, headers: {}, body: 'Unauthorized',
      });
      const { McpReauthRequiredError } = await import('../services/mcp-http');
      const cfg = {
        id: 'rovo', name: 'Rovo', type: 'http', url: 'https://mcp.atlassian.com/v1/mcp/authv2',
        enabled: true, toolsEnabled: true,
      } as McpServerConfig;
      await McpHttpTransport.initializeSession(cfg);
      await expect(McpHttpTransport.sendRequest('rovo', { jsonrpc: '2.0', id: 1, method: 'initialize' }))
        .rejects.toBeInstanceOf(McpReauthRequiredError);
    });
  });

  // ── M13: Postgres connection-string secret (#114) ─────────────────────────

  describe('M13: Postgres secret URI (#114)', () => {
    it('stdio: Postgres DATABASE_URI env var reaches spawnProcess', async () => {
      const mockSpawn = vi.spyOn(TauriMcpStdioTransport, 'spawnProcess');
      mockSpawn.mockResolvedValue({ sessionId: 'pg', command: 'uvx', args: [] });
      vi.spyOn(TauriMcpStdioTransport, 'sendRequest').mockResolvedValue(undefined);
      vi.spyOn(TauriMcpStdioTransport, 'readResponse')
        .mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}');

      mcpServerManager.addServer({
        id: 'pg', name: 'Postgres', type: 'stdio',
        command: 'uvx postgres-mcp --access-mode=restricted',
        env: { DATABASE_URI: 'postgresql://user:s3cr3t@localhost/mydb' },
        enabled: true, toolsEnabled: true,
      } as McpServerConfig);
      await mcpServerManager.connectToServer('pg');

      expect(mockSpawn).toHaveBeenCalledWith(
        'uvx',
        ['postgres-mcp', '--access-mode=restricted'],
        expect.objectContaining({ DATABASE_URI: 'postgresql://user:s3cr3t@localhost/mydb' }),
      );
      // Connection string must NOT appear in the command args directly
      const [, args] = mockSpawn.mock.calls[0] as [string, string[]];
      expect(args.some((a: string) => a.includes('@localhost'))).toBe(false);
    });
  });

  // ── M13: Custom HTTP / stdio KB (#115) ────────────────────────────────────

  describe('M13: Custom HTTP KB (#115)', () => {
    it('http: bearer API key sent in Authorization header', async () => {
      const capturedHeaders: Record<string, string>[] = [];
      McpHttpTransport._mockInvoke = async (_cmd, args) => {
        capturedHeaders.push({ ...args.request.headers });
        const req = JSON.parse(args.request.body);
        return {
          success: true, status: 200, headers: {},
          body: JSON.stringify({ jsonrpc: '2.0', id: req.id ?? 1, result: { protocolVersion: '2025-06-18', capabilities: {} } }),
        };
      };
      const cfg = {
        id: 'kb-http', name: 'Custom KB', type: 'http', url: 'https://kb.example.com/mcp',
        auth: { token: 'kb-bearer-key', type: 'bearer' as const },
        enabled: true, toolsEnabled: true,
      } as McpServerConfig;
      await McpHttpTransport.initializeSession(cfg);
      await McpHttpTransport.initialize('kb-http');
      expect(capturedHeaders.some(h => h.Authorization === 'Bearer kb-bearer-key')).toBe(true);
    });

    it('stdio: Custom stdio KB forwards MCP_API_URL and MCP_API_KEY env vars', async () => {
      const mockSpawn = vi.spyOn(TauriMcpStdioTransport, 'spawnProcess');
      mockSpawn.mockResolvedValue({ sessionId: 'kb-stdio', command: 'uvx', args: [] });
      vi.spyOn(TauriMcpStdioTransport, 'sendRequest').mockResolvedValue(undefined);
      vi.spyOn(TauriMcpStdioTransport, 'readResponse')
        .mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}');

      mcpServerManager.addServer({
        id: 'kb-stdio', name: 'Custom KB Stdio', type: 'stdio',
        command: 'uvx my-kb-server',
        env: { MCP_API_URL: 'https://api.kb.example.com', MCP_API_KEY: 'sk-kb-test' },
        enabled: true, toolsEnabled: true,
      } as McpServerConfig);
      await mcpServerManager.connectToServer('kb-stdio');

      expect(mockSpawn).toHaveBeenCalledWith(
        'uvx',
        ['my-kb-server'],
        expect.objectContaining({ MCP_API_URL: 'https://api.kb.example.com', MCP_API_KEY: 'sk-kb-test' }),
      );
    });
  });
});

// ── #461: McpHttpClient.connect() surfaces body error on non-ok ─────────────
// connect() now runs the spec initialize handshake through McpHttpTransport,
// so these drive the _mockInvoke seam instead of global.fetch.

describe('McpHttpClient connect error surfacing (#461)', () => {
  beforeEach(() => { McpHttpTransport.clearSessions(); });
  afterEach(() => { McpHttpTransport._mockInvoke = null; });

  function failingInvoke(status: number, body: string, error?: string) {
    McpHttpTransport._mockInvoke = vi.fn().mockResolvedValue({
      success: false, status, headers: {}, body, error,
    });
  }

  it('surfaces JSON-RPC error.message from a non-ok body (#461)', async () => {
    failingInvoke(403, JSON.stringify({ error: { code: -32000, message: 'Invalid API key' } }), 'Forbidden');
    const client = new McpHttpClient({
      id: 'h1', name: 'H1', type: 'http', url: 'http://x/api', enabled: true, toolsEnabled: true,
    } as McpServerConfig);
    await expect(client.connect()).rejects.toThrow('Invalid API key');
  });

  it('surfaces string error from a non-ok body (#461)', async () => {
    failingInvoke(404, JSON.stringify({ error: 'endpoint not found' }), 'Not Found');
    const client = new McpHttpClient({
      id: 'h2', name: 'H2', type: 'http', url: 'http://x/api', enabled: true, toolsEnabled: true,
    } as McpServerConfig);
    await expect(client.connect()).rejects.toThrow('endpoint not found');
  });

  it('falls back to the transport error when body has no error (#461)', async () => {
    failingInvoke(503, JSON.stringify({ unrelated: true }), 'Service Unavailable');
    const client = new McpHttpClient({
      id: 'h3', name: 'H3', type: 'http', url: 'http://x/api', enabled: true, toolsEnabled: true,
    } as McpServerConfig);
    await expect(client.connect()).rejects.toThrow('Service Unavailable');
  });

  it('falls back to the transport error when body is not JSON (#461)', async () => {
    failingInvoke(500, 'not-json', 'Internal Server Error');
    const client = new McpHttpClient({
      id: 'h4', name: 'H4', type: 'http', url: 'http://x/api', enabled: true, toolsEnabled: true,
    } as McpServerConfig);
    await expect(client.connect()).rejects.toThrow('Internal Server Error');
  });

  it('connect surfaces 401 as McpReauthRequiredError so the UI can prompt re-auth', async () => {
    failingInvoke(401, 'Unauthorized');
    const { McpReauthRequiredError } = await import('../services/mcp-http');
    const client = new McpHttpClient({
      id: 'h5', name: 'H5', type: 'http', url: 'http://x/api', enabled: true, toolsEnabled: true,
    } as McpServerConfig);
    await expect(client.connect()).rejects.toBeInstanceOf(McpReauthRequiredError);
  });
});

// ── MCP spec compliance — lifecycle & Streamable HTTP (2025-06-18) ──────────

/**
 * Build a stdio _mockInvoke that answers by method. `responses` maps a JSON-RPC
 * method to either a result object or a { error } wrapper; `sent` captures
 * every message the client wrote.
 */
function stdioMockByMethod(
  sent: any[],
  responses: Record<string, (req: any) => any>
) {
  return async (cmd: string, args: any) => {
    if (cmd === 'mcp_stdio_spawn') return { success: true, session_id: args.sessionId };
    if (cmd === 'mcp_stdio_send') { sent.push(JSON.parse(args.request)); return { success: true }; }
    if (cmd === 'mcp_stdio_read') {
      const pending = [...sent].reverse().find(m => m.id != null && !m._answered);
      if (!pending) return null;
      pending._answered = true;
      const respond = responses[pending.method];
      const payload = respond ? respond(pending) : { result: {} };
      return JSON.stringify({ jsonrpc: '2.0', id: pending.id, ...payload });
    }
    if (cmd === 'mcp_stdio_close') return { success: true };
    return { success: true };
  };
}

describe('MCP spec compliance — lifecycle (2025-06-18)', () => {
  beforeEach(() => {
    // Drop any spyOn mocks left installed by earlier suites — they would
    // shadow the _mockInvoke seam these tests drive.
    vi.restoreAllMocks();
    TauriMcpStdioTransport._mockInvoke = null;
    McpHttpTransport._mockInvoke = null;
    McpHttpTransport.clearSessions();
  });
  afterEach(() => {
    TauriMcpStdioTransport._mockInvoke = null;
    McpHttpTransport._mockInvoke = null;
    McpHttpTransport.clearSessions();
  });

  it('stdio: connect fails cleanly on an unsupported protocolVersion counter-offer', async () => {
    const sent: any[] = [];
    TauriMcpStdioTransport._mockInvoke = stdioMockByMethod(sent, {
      initialize: () => ({ result: { protocolVersion: '1999-01-01', capabilities: {} } }),
    });
    const client = new McpStdioClient({
      id: 'ver-bad', name: 'V', type: 'stdio', command: 'echo', enabled: true, toolsEnabled: true,
    } as McpServerConfig);
    await expect(client.connect()).rejects.toThrow(/Unsupported MCP protocol version/);
    // Client SHOULD disconnect: no initialized notification after a failed negotiation.
    expect(sent.some(m => m.method === 'notifications/initialized')).toBe(false);
  });

  it('stdio: accepts the server counter-offer of an older supported version', async () => {
    const sent: any[] = [];
    TauriMcpStdioTransport._mockInvoke = stdioMockByMethod(sent, {
      initialize: () => ({ result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } } }),
    });
    const client = new McpStdioClient({
      id: 'ver-old', name: 'V', type: 'stdio', command: 'echo', enabled: true, toolsEnabled: true,
    } as McpServerConfig);
    await client.connect();
    expect(client.getNegotiatedProtocolVersion()).toBe('2025-03-26');
    expect(sent.some(m => m.method === 'notifications/initialized')).toBe(true);
    await client.disconnect();
  });

  it('stdio: tools/list follows nextCursor pagination until exhausted', async () => {
    const sent: any[] = [];
    TauriMcpStdioTransport._mockInvoke = stdioMockByMethod(sent, {
      initialize: () => ({ result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } }),
      'tools/list': (req) => req.params?.cursor === 'page2'
        ? ({ result: { tools: [{ name: 'b', inputSchema: { type: 'object' } }] } })
        : ({ result: { tools: [{ name: 'a', inputSchema: { type: 'object' } }], nextCursor: 'page2' } }),
    });
    const client = new McpStdioClient({
      id: 'page-stdio', name: 'P', type: 'stdio', command: 'echo', enabled: true, toolsEnabled: true,
    } as McpServerConfig);
    await client.connect();
    const tools = await client.listTools();
    expect(tools.map(t => t.name)).toEqual(['a', 'b']);
    const listCalls = sent.filter(m => m.method === 'tools/list');
    expect(listCalls).toHaveLength(2);
    expect(listCalls[1].params).toEqual({ cursor: 'page2' });
    await client.disconnect();
  });

  it('stdio: JSON-RPC error objects pass through with code and data preserved', async () => {
    const sent: any[] = [];
    TauriMcpStdioTransport._mockInvoke = stdioMockByMethod(sent, {
      initialize: () => ({ result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } }),
      'tools/call': () => ({ error: { code: -32602, message: 'Unknown tool: nope', data: { tool: 'nope' } } }),
    });
    const client = new McpStdioClient({
      id: 'err-stdio', name: 'E', type: 'stdio', command: 'echo', enabled: true, toolsEnabled: true,
    } as McpServerConfig);
    await client.connect();
    let caught: any;
    await client.callTool('nope', {}).catch(e => { caught = e; });
    expect(caught).toBeInstanceOf(McpJsonRpcError);
    expect(caught.code).toBe(-32602);
    expect(caught.data).toEqual({ tool: 'nope' });
    await client.disconnect();
  });

  it('stdio: a tools/call result with isError:true resolves (tool error, not transport error)', async () => {
    const sent: any[] = [];
    TauriMcpStdioTransport._mockInvoke = stdioMockByMethod(sent, {
      initialize: () => ({ result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } }),
      'tools/call': () => ({ result: { content: [{ type: 'text', text: 'API rate limit exceeded' }], isError: true } }),
    });
    const client = new McpStdioClient({
      id: 'iserr-stdio', name: 'I', type: 'stdio', command: 'echo', enabled: true, toolsEnabled: true,
    } as McpServerConfig);
    await client.connect();
    const result = await client.callTool('failing', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('rate limit');
    await client.disconnect();
  });

  it('stdio: listTools is skipped when the server did not declare the tools capability', async () => {
    const sent: any[] = [];
    TauriMcpStdioTransport._mockInvoke = stdioMockByMethod(sent, {
      initialize: () => ({ result: { protocolVersion: '2025-06-18', capabilities: { prompts: {} } } }),
    });
    const client = new McpStdioClient({
      id: 'nocap-stdio', name: 'N', type: 'stdio', command: 'echo', enabled: true, toolsEnabled: true,
    } as McpServerConfig);
    await client.connect();
    const tools = await client.listTools();
    expect(tools).toEqual([]);
    expect(sent.some(m => m.method === 'tools/list')).toBe(false);
    await client.disconnect();
  });
});

describe('MCP spec compliance — Streamable HTTP transport (2025-06-18)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    McpHttpTransport._mockInvoke = null;
    McpHttpTransport.clearSessions();
  });
  afterEach(() => {
    McpHttpTransport._mockInvoke = null;
    McpHttpTransport.clearSessions();
  });

  function httpCfg(id: string, extra: Partial<McpServerConfig> = {}): McpServerConfig {
    return { id, name: id, type: 'http', url: 'http://localhost:9/mcp', enabled: true, toolsEnabled: true, ...extra } as McpServerConfig;
  }

  /** _mockInvoke answering by JSON-RPC method; captures every HTTP request. */
  function httpMockByMethod(
    calls: any[],
    responses: Record<string, (req: any) => any>,
    perRequest?: (req: any, requestIndex: number) => Partial<{ status: number; headers: Record<string, string>; body: string; success: boolean }> | undefined
  ) {
    return async (_cmd: string, args: any) => {
      calls.push(args.request);
      const req = args.request.body ? JSON.parse(args.request.body) : {};
      const override = perRequest?.(req, calls.length - 1);
      if (override) {
        return { success: true, status: 200, headers: {}, body: '', ...override };
      }
      const respond = responses[req.method];
      const payload = respond ? respond(req) : { result: {} };
      return {
        success: true, status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: req.id ?? null, ...payload }),
      };
    };
  }

  const initResult = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 's', version: '1' } };

  it('sends Accept: application/json + text/event-stream on every request', async () => {
    const calls: any[] = [];
    McpHttpTransport._mockInvoke = httpMockByMethod(calls, { initialize: () => ({ result: initResult }) });
    await McpHttpTransport.initializeSession(httpCfg('acc'));
    await McpHttpTransport.initialize('acc');
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers.Accept).toContain('application/json');
      expect(call.headers.Accept).toContain('text/event-stream');
    }
  });

  it('sends MCP-Protocol-Version on every request after initialize (not on initialize itself)', async () => {
    const calls: any[] = [];
    McpHttpTransport._mockInvoke = httpMockByMethod(calls, {
      initialize: () => ({ result: initResult }),
      'tools/call': () => ({ result: { content: [] } }),
    });
    await McpHttpTransport.initializeSession(httpCfg('pv'));
    await McpHttpTransport.initialize('pv');
    await McpHttpTransport.callTool('pv', 'x', {});

    const initCall = calls.find(c => JSON.parse(c.body).method === 'initialize');
    expect(initCall.headers['MCP-Protocol-Version']).toBeUndefined(); // nothing negotiated yet
    const initializedNote = calls.find(c => JSON.parse(c.body).method === 'notifications/initialized');
    expect(initializedNote.headers['MCP-Protocol-Version']).toBe('2025-06-18');
    const toolCall = calls.find(c => JSON.parse(c.body).method === 'tools/call');
    expect(toolCall.headers['MCP-Protocol-Version']).toBe('2025-06-18');
  });

  it('captures Mcp-Session-Id from the initialize response and echoes it on subsequent requests', async () => {
    const calls: any[] = [];
    McpHttpTransport._mockInvoke = httpMockByMethod(calls, {
      initialize: () => ({ result: initResult }),
      'tools/call': () => ({ result: { content: [] } }),
    }, (req) => req.method === 'initialize'
      ? { headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-42' }, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result: initResult }) }
      : undefined);
    await McpHttpTransport.initializeSession(httpCfg('sid'));
    await McpHttpTransport.initialize('sid');
    await McpHttpTransport.callTool('sid', 'x', {});

    expect(McpHttpTransport.getMcpSessionId('sid')).toBe('sess-42');
    const afterInit = calls.filter(c => {
      const m = JSON.parse(c.body).method;
      return m === 'notifications/initialized' || m === 'tools/call';
    });
    expect(afterInit.length).toBeGreaterThan(0);
    for (const call of afterInit) {
      expect(call.headers['Mcp-Session-Id']).toBe('sess-42');
    }
  });

  it('starts a new session (re-initialize + retry) when a request with a session id gets 404', async () => {
    const calls: any[] = [];
    let expired = true;
    McpHttpTransport._mockInvoke = httpMockByMethod(calls, {
      initialize: () => ({ result: initResult }),
      'tools/call': () => ({ result: { content: [{ type: 'text', text: 'ok' }] } }),
    }, (req) => {
      if (req.method === 'initialize') {
        return { headers: { 'content-type': 'application/json', 'mcp-session-id': expired ? 'stale' : 'fresh' }, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result: initResult }) };
      }
      if (req.method === 'tools/call' && expired) {
        expired = false; // next initialize hands out the fresh session
        return { success: false, status: 404, headers: {} as Record<string, string>, body: 'Session Not Found' };
      }
      return undefined;
    });
    await McpHttpTransport.initializeSession(httpCfg('re'));
    await McpHttpTransport.initialize('re');
    const result = await McpHttpTransport.callTool('re', 'x', {});
    expect(result.content[0].text).toBe('ok');
    expect(McpHttpTransport.getMcpSessionId('re')).toBe('fresh');
    const initCount = calls.filter(c => JSON.parse(c.body).method === 'initialize').length;
    expect(initCount).toBe(2);
  });

  it('parses an SSE (text/event-stream) response and emits interleaved notifications', async () => {
    const calls: any[] = [];
    McpHttpTransport._mockInvoke = httpMockByMethod(calls, {
      initialize: () => ({ result: initResult }),
    }, (req) => {
      if (req.method !== 'tools/call') return undefined;
      const note = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'working' } });
      const resp = JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: 'from-sse' }] } });
      return {
        headers: { 'content-type': 'text/event-stream' },
        body: `event: message\ndata: ${note}\n\nevent: message\ndata: ${resp}\n\n`,
      };
    });
    await McpHttpTransport.initializeSession(httpCfg('sse'));
    await McpHttpTransport.initialize('sse');
    const notes: any[] = [];
    McpHttpTransport.on('sse', 'notifications/message', d => notes.push(d));
    const result = await McpHttpTransport.callTool('sse', 'x', {});
    expect(result.content[0].text).toBe('from-sse');
    expect(notes).toEqual([{ level: 'info', data: 'working' }]);
  });

  it('tools/list paginates with nextCursor over HTTP', async () => {
    const calls: any[] = [];
    McpHttpTransport._mockInvoke = httpMockByMethod(calls, {
      initialize: () => ({ result: initResult }),
      'tools/list': (req) => req.params?.cursor === 'c2'
        ? ({ result: { tools: [{ name: 'two', inputSchema: { type: 'object' } }] } })
        : ({ result: { tools: [{ name: 'one', inputSchema: { type: 'object' } }], nextCursor: 'c2' } }),
    });
    await McpHttpTransport.initializeSession(httpCfg('pg'));
    const tools = await McpHttpTransport.listTools('pg'); // auto-initializes first
    expect(tools.map(t => t.name)).toEqual(['one', 'two']);
    const listCalls = calls.filter(c => JSON.parse(c.body).method === 'tools/list');
    expect(listCalls).toHaveLength(2);
    expect(JSON.parse(listCalls[1].body).params).toEqual({ cursor: 'c2' });
  });

  it('initialize rejects an unsupported protocolVersion counter-offer', async () => {
    const calls: any[] = [];
    McpHttpTransport._mockInvoke = httpMockByMethod(calls, {
      initialize: () => ({ result: { protocolVersion: '1888-01-01', capabilities: {} } }),
    });
    await McpHttpTransport.initializeSession(httpCfg('badver'));
    await expect(McpHttpTransport.initialize('badver')).rejects.toThrow(/Unsupported MCP protocol version/);
    // No initialized notification after a failed negotiation.
    expect(calls.some(c => JSON.parse(c.body).method === 'notifications/initialized')).toBe(false);
  });

  it('runs the initialize handshake automatically before a first non-initialize request', async () => {
    const calls: any[] = [];
    McpHttpTransport._mockInvoke = httpMockByMethod(calls, {
      initialize: () => ({ result: initResult }),
      'tools/call': () => ({ result: { content: [] } }),
    });
    await McpHttpTransport.initializeSession(httpCfg('auto'));
    await McpHttpTransport.callTool('auto', 'x', {}); // no explicit initialize
    const methods = calls.map(c => JSON.parse(c.body).method);
    expect(methods.indexOf('initialize')).toBe(0);
    expect(methods.indexOf('notifications/initialized')).toBeLessThan(methods.indexOf('tools/call'));
  });

  it('sends DELETE with the session id on terminateSession', async () => {
    const calls: any[] = [];
    McpHttpTransport._mockInvoke = httpMockByMethod(calls, {
      initialize: () => ({ result: initResult }),
    }, (req) => req.method === 'initialize'
      ? { headers: { 'content-type': 'application/json', 'Mcp-Session-Id': 'kill-me' }, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result: initResult }) }
      : undefined);
    await McpHttpTransport.initializeSession(httpCfg('del'));
    await McpHttpTransport.initialize('del');
    await McpHttpTransport.terminateSession('del');
    const del = calls.find(c => c.method === 'DELETE');
    expect(del).toBeDefined();
    expect(del.headers['Mcp-Session-Id']).toBe('kill-me');
    expect(McpHttpTransport.isConnected('del')).toBe(false);
  });
});

describe('parseSseMessages', () => {
  it('extracts JSON payloads from data: lines across events', () => {
    const body = 'event: message\ndata: {"a":1}\n\n: keep-alive\n\ndata: {"b":2}\n\n';
    expect(parseSseMessages(body)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('joins multi-line data fields and skips non-JSON events', () => {
    const body = 'data: {"a":\ndata: 1}\n\ndata: not-json\n\n';
    expect(parseSseMessages(body)).toEqual([{ a: 1 }]);
  });

  it('tolerates CRLF separators', () => {
    const body = 'data: {"x":true}\r\n\r\n';
    expect(parseSseMessages(body)).toEqual([{ x: true }]);
  });
});
