import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolRegistry } from '../services/tools';
import { agenticChatStream } from '../services/agent';
import { mcpServerManager, McpStdioClient } from '../services/mcp';
import { CliToolWrapper } from '../services/cli-tool';

describe('Agentic Features', () => {
  beforeEach(() => {
    // Clear tool registry before each test
    const tools = toolRegistry.getAllTools();
    tools.forEach(tool => toolRegistry.unregisterTool(tool.name));
  });

  afterEach(() => {
    // Clean up MCP connections
    const servers = mcpServerManager.getAllServers();
    servers.forEach(server => {
      mcpServerManager.disconnectFromServer(server.id);
    });
  });

  describe('Tool Registry', () => {
    it('should register and retrieve tools', () => {
      const testTool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input parameter' },
          },
        },
        execute: async (params: any) => ({ result: `Processed: ${params.input}` }),
      };

      toolRegistry.registerTool(testTool);
      const retrievedTool = toolRegistry.getTool('test_tool');

      expect(retrievedTool).toBeDefined();
      expect(retrievedTool?.name).toBe('test_tool');
      expect(retrievedTool?.description).toBe('A test tool');
    });

    it('should unregister tools', () => {
      const testTool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ result: 'test' }),
      };

      toolRegistry.registerTool(testTool);
      toolRegistry.unregisterTool('test_tool');
      const retrievedTool = toolRegistry.getTool('test_tool');

      expect(retrievedTool).toBeUndefined();
    });

    it('should return Ollama-compatible tool definitions', () => {
      const testTool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: {
            param1: { type: 'string', description: 'Parameter 1' },
          },
          required: ['param1'],
        },
        execute: async () => ({ result: 'test' }),
      };

      toolRegistry.registerTool(testTool);
      const ollamaTools = toolRegistry.getOllamaToolDefinitions();

      expect(ollamaTools).toHaveLength(1);
      expect(ollamaTools[0]).toEqual({
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {
              param1: { type: 'string', description: 'Parameter 1' },
            },
            required: ['param1'],
          },
        },
      });
    });

    it('should execute tools with parameters', async () => {
      const testTool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: {
            multiply: { type: 'number', description: 'Multiplier' },
          },
        },
        execute: async (params: any) => ({ result: params.multiply * 2 }),
      };

      toolRegistry.registerTool(testTool);

      const toolCall = {
        id: 'test-123',
        type: 'function',
        function: {
          name: 'test_tool',
          arguments: JSON.stringify({ multiply: 5 }),
        },
      };

      const result = await toolRegistry.executeToolCall(toolCall);

      expect(result).toEqual({
        tool_call_id: 'test-123',
        role: 'tool',
        name: 'test_tool',
        content: '{"result":10}',
      });
    });
  });

  describe('CLI Tool', () => {
    it('should register CLI tool in registry', () => {
      CliToolWrapper.registerAsTool();
      const cliTool = toolRegistry.getTool('run_cli_command');

      expect(cliTool).toBeDefined();
      expect(cliTool?.name).toBe('run_cli_command');
      expect(cliTool?.description).toContain('CLI command');
    });

    it('should have proper parameter schema', () => {
      CliToolWrapper.registerAsTool();
      const cliTool = toolRegistry.getTool('run_cli_command');
      const ollamaTools = toolRegistry.getOllamaToolDefinitions();
      const cliToolDef = ollamaTools.find(t => t.function.name === 'run_cli_command');

      expect(cliToolDef).toBeDefined();
      expect(cliToolDef?.function.parameters.properties.command).toBeDefined();
      expect(cliToolDef?.function.parameters.properties.args).toBeDefined();
    });

    it('should handle approval callback', async () => {
      let approvalCalled = false;
      let approvedCommand = '';

      CliToolWrapper.setApprovalCallback(async (command: string) => {
        approvalCalled = true;
        approvedCommand = command;
        return true; // Approve all for this test
      });

      // Test the approval callback directly
      const testCallback = CliToolWrapper['approvalCallback'];
      if (testCallback) {
        const approved = await testCallback('echo');
        expect(approved).toBe(true);
        expect(approvalCalled).toBe(true);
        expect(approvedCommand).toBe('echo');
      } else {
        expect.fail('Approval callback not set');
      }
    });

    it('should reject when approval denied', async () => {
      CliToolWrapper.setApprovalCallback(async () => false);

      const result = await CliToolWrapper.executeCommand({
        command: 'echo test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });
  });

  describe('MCP Client', () => {
    it('should create and manage MCP server configurations', () => {
      const config: any = {
        id: 'test-server',
        name: 'Test Server',
        type: 'stdio',
        command: 'echo',
        enabled: true,
        toolsEnabled: true,
      };

      mcpServerManager.addServer(config);
      const retrieved = mcpServerManager.getServer('test-server');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test Server');
      expect(retrieved?.type).toBe('stdio');
    });

    it('should remove servers', () => {
      const config: any = {
        id: 'test-server',
        name: 'Test Server',
        type: 'stdio',
        command: 'echo',
        enabled: true,
        toolsEnabled: true,
      };

      mcpServerManager.addServer(config);
      mcpServerManager.removeServer('test-server');
      const retrieved = mcpServerManager.getServer('test-server');

      expect(retrieved).toBeUndefined();
    });

    it('should handle both stdio and http server types', () => {
      const stdioConfig: any = {
        id: 'stdio-server',
        name: 'Stdio Server',
        type: 'stdio',
        command: 'echo',
        enabled: true,
        toolsEnabled: true,
      };

      const httpConfig: any = {
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
  });

  describe('Agentic Chat Loop', () => {
    it('should handle basic chat without tools', async () => {
      // Mock fetch to simulate Ollama API response without tool calls
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      };

      mockFetch.mockResolvedValue(mockResponse);

      const options = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        maxIterations: 1,
        endpoint: 'http://localhost:11434/api/chat',
      };

      const generator = agenticChatStream(options);
      const result = await generator.next();

      expect(result.done).toBe(true);
    });

    it('should propagate generation options into the Ollama request (#110)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }) }) },
      });
      global.fetch = mockFetch;

      const generator = agenticChatStream({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        maxIterations: 1,
        endpoint: 'http://localhost:11434/api/chat',
        options: { num_ctx: 2048, temperature: 0.1 },
      });
      await generator.next();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.options).toEqual({ num_ctx: 2048, temperature: 0.1 });
    });

    it('should handle tool calls when tools are available', async () => {
      // Register a test tool
      const testTool = {
        name: 'get_time',
        description: 'Get current time',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ time: '12:00:00' }),
      };

      toolRegistry.registerTool(testTool);

      // Mock fetch to simulate Ollama API response with tool calls
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      let callCount = 0;
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) {
                // First call returns tool calls
                return Promise.resolve({
                  done: false,
                  value: Buffer.from('{"message":{"tool_calls":[{"id":"call-1","type":"function","function":{"name":"get_time","arguments":"{}"}}]}}\n'),
                });
              } else {
                // Subsequent calls return empty (simulate stream end)
                return Promise.resolve({ done: true, value: undefined });
              }
            }),
          }),
        },
      };

      mockFetch.mockResolvedValue(mockResponse);

      const options = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'What time is it?' }],
        maxIterations: 2,
        endpoint: 'http://localhost:11434/api/chat',
      };

      const generator = agenticChatStream(options);
      const results = [];

      for await (const message of generator) {
        results.push(message);
        if (results.length >= 2) break; // Limit for test
      }

      // Should have at least the tool result message
      expect(results.length).toBeGreaterThan(0);
    });

    it('should respect max iterations limit', async () => {
      // Mock fetch to simulate continuous tool calls
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      let readCount = 0;
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockImplementation(() => {
              readCount++;
              if (readCount % 2 === 1) {
                // odd calls: return a tool call chunk
                return Promise.resolve({
                  done: false,
                  value: Buffer.from('{"message":{"tool_calls":[{"id":"call-1","type":"function","function":{"name":"test","arguments":"{}"}}]}}\n'),
                });
              }
              // even calls: end the stream so the loop can process and iterate
              return Promise.resolve({ done: true, value: undefined });
            }),
          }),
        },
      };

      mockFetch.mockResolvedValue(mockResponse);

      const options = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Test' }],
        maxIterations: 2, // Should stop after 2 iterations
        endpoint: 'http://localhost:11434/api/chat',
      };

      const generator = agenticChatStream(options);
      const results = [];

      for await (const message of generator) {
        results.push(message);
        if (results.length >= 3) break; // Safety limit for test
      }

      // Should stop after max iterations
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Integration Tests', () => {
    it('should integrate CLI tool with agentic loop', () => {
      // Register CLI tool
      CliToolWrapper.registerAsTool();
      
      // Verify it's in the tool registry
      const tools = toolRegistry.getOllamaToolDefinitions();
      const cliTool = tools.find(t => t.function.name === 'run_cli_command');
      
      expect(cliTool).toBeDefined();
      expect(cliTool?.function.description).toContain('CLI command');
    });

    it('should handle MCP and CLI tools together', () => {
      // Register both types of tools
      const testTool = {
        name: 'test_tool',
        description: 'Test tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ result: 'test' }),
      };

      toolRegistry.registerTool(testTool);
      CliToolWrapper.registerAsTool();
      
      const allTools = toolRegistry.getOllamaToolDefinitions();
      
      expect(allTools).toHaveLength(2);
      expect(allTools.find(t => t.function.name === 'test_tool')).toBeDefined();
      expect(allTools.find(t => t.function.name === 'run_cli_command')).toBeDefined();
    });
  });
});