import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mcpServerManager, McpStdioClient, McpHttpClient } from '../services/mcp';
import { McpHttpTransport } from '../services/mcp-http';
import { TauriMcpStdioTransport } from '../services/mcp-tauri';

describe('MCP Transport Tests', () => {
  beforeEach(() => {
    // Clear any existing servers and connections
    const servers = mcpServerManager.getAllServers();
    servers.forEach(server => mcpServerManager.removeServer(server.id));
  });

  afterEach(() => {
    // Clean up any active connections
    const servers = mcpServerManager.getAllServers();
    servers.forEach(server => mcpServerManager.disconnectFromServer(server.id));
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

      // Mock the Tauri transport
      const mockSpawn = vi.spyOn(TauriMcpStdioTransport, 'spawnProcess');
      mockSpawn.mockResolvedValue({
        sessionId: 'test-session',
        command: 'echo',
        args: [],
      });

      // Mock the sendRequest to avoid infinite waiting
      const mockSend = vi.spyOn(TauriMcpStdioTransport, 'sendRequest');
      mockSend.mockResolvedValue(undefined);

      // Mock the readResponse to return immediately
      const mockRead = vi.spyOn(TauriMcpStdioTransport, 'readResponse');
      mockRead.mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"version":"1.0"}}');

      const client = await mcpServerManager.connectToServer('test-stdio');
      expect(client).toBeInstanceOf(McpStdioClient);
      expect(mockSpawn).toHaveBeenCalled();
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

      // Mock the Tauri transport
      const mockSpawn = vi.spyOn(TauriMcpStdioTransport, 'spawnProcess');
      mockSpawn.mockResolvedValue({
        sessionId: 'test-session',
        command: 'echo',
        args: [],
      });

      const mockSend = vi.spyOn(TauriMcpStdioTransport, 'sendRequest');
      mockSend.mockResolvedValue(undefined);

      const client = await mcpServerManager.connectToServer('test-stdio') as McpStdioClient;
      
      // Mock the initialize response
      const mockRead = vi.spyOn(TauriMcpStdioTransport, 'readResponse');
      mockRead.mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"version":"1.0"}}');

      // Test initialization with timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Test timeout')), 1000)
      );
      
      await expect(Promise.race([
        client.initialize(),
        timeoutPromise
      ])).resolves.toBeDefined();
    });

      const mockSend = vi.spyOn(TauriMcpStdioTransport, 'sendRequest');
      mockSend.mockResolvedValue(undefined);

      const client = await mcpServerManager.connectToServer('test-stdio') as McpStdioClient;
      
      // Mock the initialize response
      const mockRead = vi.spyOn(TauriMcpStdioTransport, 'readResponse');
      mockRead.mockResolvedValue('{"jsonrpc":"2.0","id":1,"result":{"version":"1.0"}}');

      // Test initialization
      await expect(client.initialize()).resolves.toBeDefined();
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

      // Mock the Tauri transport
      const mockSpawn = vi.spyOn(TauriMcpStdioTransport, 'spawnProcess');
      mockSpawn.mockResolvedValue({
        sessionId: 'test-session',
        command: 'echo',
        args: [],
      });

      const mockClose = vi.spyOn(TauriMcpStdioTransport, 'closeProcess');
      mockClose.mockResolvedValue(undefined);

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
        auth: {
          token: 'test-token',
          type: 'bearer',
        },
      };

      // Mock the invoke function
      const mockInvoke = vi.fn().mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"result":{"version":"1.0"}}',
      });

      // Temporarily replace the mock in McpHttpTransport
      const originalInvoke = McpHttpTransport['invoke'];
      McpHttpTransport['invoke'] = mockInvoke;

      try {
        await McpHttpTransport.initializeSession(config);
        
        const request = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        };

        const result = await McpHttpTransport.sendRequest('test-http', request);
        
        expect(result).toEqual({ version: '1.0' });
        expect(mockInvoke).toHaveBeenCalled();
        
        // Check that the request included the auth token
        const callArgs = mockInvoke.mock.calls[0][1];
        expect(callArgs.request.headers.Authorization).toContain('Bearer test-token');
      } finally {
        McpHttpTransport['invoke'] = originalInvoke;
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

      // Mock the invoke function to return an error
      const mockInvoke = vi.fn().mockResolvedValue({
        success: false,
        status: 500,
        headers: {},
        body: 'Internal Server Error',
        error: 'Server error',
      });

      // Temporarily replace invoke
      const originalInvoke = global.invoke;
      global.invoke = mockInvoke;

      try {
        await McpHttpTransport.initializeSession(config);
        
        const request = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        };

        await expect(McpHttpTransport.sendRequest('test-http', request))
          .rejects
          .toThrow('MCP HTTP request failed');
      } finally {
        global.invoke = originalInvoke;
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

      // Mock the invoke function to return a valid HTTP response but MCP error
      const mockInvoke = vi.fn().mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}',
      });

      // Temporarily replace invoke
      const originalInvoke = global.invoke;
      global.invoke = mockInvoke;

      try {
        await McpHttpTransport.initializeSession(config);
        
        const request = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        };

        await expect(McpHttpTransport.sendRequest('test-http', request))
          .rejects
          .toThrow('Method not found');
      } finally {
        global.invoke = originalInvoke;
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

      // Mock the HTTP transport
      const mockInvoke = vi.fn().mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"result":[{"name":"test_tool","description":"A test tool"}]}',
      });

      const originalInvoke = global.invoke;
      global.invoke = mockInvoke;

      try {
        const tools = await mcpServerManager.discoverTools('test-server');
        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe('test_tool');
      } finally {
        global.invoke = originalInvoke;
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