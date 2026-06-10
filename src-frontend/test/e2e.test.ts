import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { mcpServerManager } from '../services/mcp';
import { toolRegistry } from '../services/tools';
import { CliToolWrapper } from '../services/cli-tool';

describe('End-to-End Tests', () => {
  beforeAll(() => {
    // Initialize tools
    toolRegistry.registerTool({
      name: 'test_tool',
      description: 'A test tool for E2E testing',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
      },
      execute: async (params: any) => ({ result: `Processed: ${params.input}` }),
    });
    
    // Initialize CLI tool with mock
    CliToolWrapper.initializeWithTauri(vi.fn().mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: "CLI output",
      stderr: "",
      timedOut: false,
    }));
  });

  afterAll(() => {
    // Clean up
    const tools = toolRegistry.getAllTools();
    tools.forEach(tool => toolRegistry.unregisterTool(tool.name));
  });

  describe('Core Chat Flow', () => {
    it('should render the main chat interface', () => {
      render(<App />);
      
      expect(screen.getByText('Ollama GUI')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument();
      expect(screen.getByText('Send')).toBeInTheDocument();
    });

    it('should send and receive messages', async () => {
      // Mock fetch for Ollama API
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValueOnce({
              done: false,
              value: Buffer.from('{"message":{"content":"Hello"}}\n'),
            }).mockResolvedValueOnce({
              done: false,
              value: Buffer.from('{"message":{"content":" there!"}}\n'),
            }).mockResolvedValueOnce({
              done: true,
              value: undefined,
            }),
          }),
        },
      };

      mockFetch.mockResolvedValue(mockResponse);

      render(<App />);

      const input = screen.getByPlaceholderText('Message Ollama...');
      const sendButton = screen.getByText('Send');

      fireEvent.change(input, { target: { value: 'Hello' } });
      fireEvent.click(sendButton);

      // Wait for messages to appear
      await waitFor(() => {
        expect(screen.getByText('Hello')).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it('should create and switch between chat sessions', async () => {
      render(<App />);

      // Create first session
      const input = screen.getByPlaceholderText('Message Ollama...');
      const sendButton = screen.getByText('Send');

      fireEvent.change(input, { target: { value: 'First message' } });
      fireEvent.click(sendButton);

      // Create new chat
      const newChatButton = screen.getByText('+ New Chat');
      fireEvent.click(newChatButton);

      // Verify new session is empty
      expect(screen.queryByText('First message')).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText('Message Ollama...')).toHaveValue('');
    });
  });

  describe('Settings and Configuration', () => {
    it('should open and close settings overlay', async () => {
      render(<App />);

      // Open settings
      const settingsButton = screen.getByText('⚙️ Settings');
      fireEvent.click(settingsButton);

      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByText('Ollama Endpoint')).toBeInTheDocument();

      // Close settings
      const closeButton = screen.getByText('✕');
      fireEvent.click(closeButton);

      expect(screen.queryByText('Ollama Endpoint')).not.toBeInTheDocument();
    });

    it('should update system prompt', async () => {
      render(<App />);

      const settingsButton = screen.getByText('⚙️ Settings');
      fireEvent.click(settingsButton);

      const systemPromptInput = screen.getByPlaceholderText('Enter the AI\'s persona...');
      fireEvent.change(systemPromptInput, { target: { value: 'New system prompt' } });

      expect(systemPromptInput).toHaveValue('New system prompt');
    });

    it('should toggle agentic mode', async () => {
      render(<App />);

      const settingsButton = screen.getByText('⚙️ Settings');
      fireEvent.click(settingsButton);

      const agenticToggle = screen.getByText('Enable tool calling');
      fireEvent.click(agenticToggle);

      expect(screen.getByText('Enabled')).toBeInTheDocument();
    });
  });

  describe('MCP Server Management', () => {
    it('should add and manage MCP servers', async () => {
      render(<App />);

      const settingsButton = screen.getByText('⚙️ Settings');
      fireEvent.click(settingsButton);

      // Add MCP server button
      const addServerButton = screen.getByText('+ Add');
      fireEvent.click(addServerButton);

      // Fill in server details
      const nameInput = screen.getByPlaceholderText('Server name');
      fireEvent.change(nameInput, { target: { value: 'Test Server' } });

      const typeSelect = screen.getByDisplayValue('stdio');
      fireEvent.change(typeSelect, { target: { value: 'http' } });

      const urlInput = screen.getByPlaceholderText('URL (e.g. https://mcp.example.com)');
      fireEvent.change(urlInput, { target: { value: 'http://localhost:8080' } });

      // Add server
      const addButton = screen.getByText('Add Server');
      fireEvent.click(addButton);

      // Verify server appears in list
      await waitFor(() => {
        expect(screen.getByText('Test Server')).toBeInTheDocument();
      });
    });

    it('should connect to MCP servers', async () => {
      // Mock the MCP HTTP transport
      const mockSend = vi.fn().mockResolvedValue({
        version: '1.0',
      });

      // Temporarily replace the transport method
      const originalSend = McpHttpTransport.sendRequest;
      McpHttpTransport.sendRequest = mockSend;

      try {
        render(<App />);

        const settingsButton = screen.getByText('⚙️ Settings');
        fireEvent.click(settingsButton);

        // Add a server
        const addServerButton = screen.getByText('+ Add');
        fireEvent.click(addServerButton);

        const nameInput = screen.getByPlaceholderText('Server name');
        fireEvent.change(nameInput, { target: { value: 'Test Server' } });

        const urlInput = screen.getByPlaceholderText('URL (e.g. https://mcp.example.com)');
        fireEvent.change(urlInput, { target: { value: 'http://localhost:8080' } });

        const addButton = screen.getByText('Add Server');
        fireEvent.click(addButton);

        // Connect to server
        await waitFor(() => {
          const connectButton = screen.getByText('Connect');
          if (connectButton) {
            fireEvent.click(connectButton);
          }
        }, { timeout: 2000 });

        // Verify connection status
        await waitFor(() => {
          const connectedIndicator = screen.queryByText('🔗');
          expect(connectedIndicator).toBeInTheDocument();
        }, { timeout: 3000 });
      } finally {
        McpHttpTransport.sendRequest = originalSend;
      }
    });
  });

  describe('Tool Integration', () => {
    it('should show available tools in settings', async () => {
      render(<App />);

      const settingsButton = screen.getByText('⚙️ Settings');
      fireEvent.click(settingsButton);

      expect(screen.getByText('Available Tools (1)')).toBeInTheDocument();
      expect(screen.getByText('test_tool')).toBeInTheDocument();
    });

    it('should enable/disable tools', async () => {
      render(<App />);

      const settingsButton = screen.getByText('⚙️ Settings');
      fireEvent.click(settingsButton);

      // Tools are shown as enabled by default
      expect(screen.getByText('✓')).toBeInTheDocument();
    });
  });

  describe('CLI Tool Integration', () => {
    it('should register CLI tool in tool registry', () => {
      expect(toolRegistry.getTool('run_cli_command')).toBeDefined();
    });

    it('should handle CLI tool approval', async () => {
      // Mock approval callback
      let approvalCalled = false;
      CliToolWrapper.setApprovalCallback(async (command: string) => {
        approvalCalled = true;
        return true;
      });

      // Test approval flow
      const result = await CliToolWrapper.executeCommand({
        command: 'echo test',
      });

      expect(approvalCalled).toBe(true);
      expect(result.success).toBe(true);
    });
  });

  describe('Responsive Design', () => {
    it('should handle mobile screen sizes', () => {
      // Set mobile viewport
      global.innerWidth = 375;
      global.dispatchEvent(new Event('resize'));

      render(<App />);

      // On mobile, sidebar should be collapsed by default
      expect(screen.queryByText('Ollama GUI')).not.toBeVisible();

      // Mobile menu button should be visible
      expect(screen.getByText('⋯')).toBeInTheDocument();
    });

    it('should toggle sidebar on mobile', async () => {
      global.innerWidth = 375;
      global.dispatchEvent(new Event('resize'));

      render(<App />);

      const menuButton = screen.getByText('⋯');
      fireEvent.click(menuButton);

      // Sidebar should now be visible
      expect(screen.getByText('Ollama GUI')).toBeVisible();
    });
  });

  describe('Error Handling', () => {
    it('should handle Ollama API errors gracefully', async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Service Unavailable',
      });

      render(<App />);

      const input = screen.getByPlaceholderText('Message Ollama...');
      const sendButton = screen.getByText('Send');

      fireEvent.change(input, { target: { value: 'Test' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText(/Could not connect to Ollama/)).toBeInTheDocument();
      });
    });

    it('should handle MCP connection errors', async () => {
      // Mock failing MCP connection
      const mockSend = vi.fn().mockRejectedValue(new Error('Connection failed'));

      const originalSend = McpHttpTransport.sendRequest;
      McpHttpTransport.sendRequest = mockSend;

      try {
        render(<App />);

        const settingsButton = screen.getByText('⚙️ Settings');
        fireEvent.click(settingsButton);

        // Add server and try to connect
        const addServerButton = screen.getByText('+ Add');
        fireEvent.click(addServerButton);

        const nameInput = screen.getByPlaceholderText('Server name');
        fireEvent.change(nameInput, { target: { value: 'Test Server' } });

        const urlInput = screen.getByPlaceholderText('URL (e.g. https://mcp.example.com)');
        fireEvent.change(urlInput, { target: { value: 'http://localhost:8080' } });

        const addButton = screen.getByText('Add Server');
        fireEvent.click(addButton);

        // Try to connect
        await waitFor(() => {
          const connectButton = screen.getByText('Connect');
          if (connectButton) {
            fireEvent.click(connectButton);
          }
        }, { timeout: 2000 });

        // Verify error is shown
        await waitFor(() => {
          const errorIndicator = screen.queryByText('error');
          expect(errorIndicator).toBeInTheDocument();
        }, { timeout: 3000 });
      } finally {
        McpHttpTransport.sendRequest = originalSend;
      }
    });
  });

  describe('Accessibility', () => {
    it('should have proper keyboard navigation', () => {
      render(<App />);

      const input = screen.getByPlaceholderText('Message Ollama...');
      const sendButton = screen.getByText('Send');

      expect(input).toHaveAttribute('tabindex', '0');
      expect(sendButton).toHaveAttribute('tabindex', '0');
    });

    it('should have proper ARIA attributes', () => {
      render(<App />);

      const settingsButton = screen.getByText('⚙️ Settings');
      expect(settingsButton).toHaveAttribute('title', 'Settings (Ctrl+,)');
    });
  });
});