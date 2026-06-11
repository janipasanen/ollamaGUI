import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mcpServerManager, McpStdioClient, McpHttpClient } from '../services/mcp';
import type { McpServerConfig } from '../services/mcp';
import { McpHttpTransport } from '../services/mcp-http';
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
      mockRead.mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"version":"1.0"}}');

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
        .mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"version":"1.0"}}');

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
        if (readCount === 1) return '{"jsonrpc":"2.0","id":1,"result":{"version":"1.0"}}';
        if (readCount === 2) return '{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}';
        return null;
      });

      const client = await mcpServerManager.connectToServer('test-stdio') as McpStdioClient;
      expect(client).toBeInstanceOf(McpStdioClient);
      expect(mockSend).toHaveBeenCalled();
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
      mockRead.mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"version":"1.0"}}');

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

        const request = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
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
        const request = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };

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
        const request = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };

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

      // McpHttpClient.connect() uses fetch; listTools() uses _mockInvoke
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '1.0' }),
      });

      // All invoke calls return the tools list
      McpHttpTransport._mockInvoke = vi.fn().mockResolvedValue({
        success: true, status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"result":[{"name":"test_tool","description":"A test tool","parameters":{"type":"object","properties":{}}}]}',
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
          if (lastReq.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: {} };
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
            : { protocolVersion: '2025-06-18', capabilities: {} };
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
      const [, args] = mockSpawn.mock.calls[0];
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