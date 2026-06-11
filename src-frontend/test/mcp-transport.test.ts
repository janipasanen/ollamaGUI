import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mcpServerManager, McpStdioClient, McpHttpClient } from '../services/mcp';
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
    vi.restoreAllMocks();
  });

  afterEach(() => {
    const servers = mcpServerManager.getAllServers();
    servers.forEach(server => mcpServerManager.disconnectFromServer(server.id));
    McpHttpTransport._mockInvoke = null;
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
});