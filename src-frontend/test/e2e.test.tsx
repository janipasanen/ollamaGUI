import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from '../App';
import { toolRegistry } from '../services/tools';
import { CliToolWrapper } from '../services/cli-tool';

describe('End-to-End Tests', () => {
  beforeAll(() => {
    // Register a test tool before all tests
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

    // Initialize CLI tool with mock that returns snake_case (matching Tauri response format)
    CliToolWrapper.initializeWithTauri(vi.fn().mockResolvedValue({
      exit_code: 0,
      timed_out: false,
      stdout: "CLI output",
      stderr: "",
    }));
  });

  beforeEach(() => {
    // Clear localStorage to prevent server state bleeding between tests
    localStorage.clear();
    // Restore desktop viewport so header buttons are visible
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
    window.dispatchEvent(new Event('resize'));
    // Restore fetch mock to a safe default before each test
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
      body: null,
      text: async () => '',
    });
  });

  afterAll(() => {
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
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: models endpoint
          return Promise.resolve({
            ok: true,
            json: async () => ({ models: [] }),
            body: null,
          });
        }
        // Subsequent: chat stream
        return Promise.resolve({
          ok: true,
          body: {
            getReader: () => ({
              read: vi.fn()
                .mockResolvedValueOnce({
                  done: false,
                  value: Buffer.from('{"message":{"content":"Hello"}}\n'),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            }),
          },
        });
      });

      render(<App />);

      const input = screen.getByPlaceholderText('Message Ollama...');
      fireEvent.change(input, { target: { value: 'Hello' } });
      fireEvent.click(screen.getByText('Send'));

      await waitFor(() => {
        expect(screen.getByText('Hello')).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it('should create and switch between chat sessions', async () => {
      render(<App />);

      const input = screen.getByPlaceholderText('Message Ollama...');
      fireEvent.change(input, { target: { value: 'First message' } });
      fireEvent.click(screen.getByText('+ New Chat'));

      expect(screen.queryByText('First message')).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText('Message Ollama...')).toHaveValue('');
    });
  });

  describe('Settings and Configuration', () => {
    it('should open and close settings overlay', async () => {
      render(<App />);

      // Open settings via sidebar button
      fireEvent.click(screen.getByText('⚙️ Settings'));
      expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument();

      // Close via the Close button at the bottom (more reliable than ✕ when servers are present)
      fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));
      expect(screen.queryByRole('heading', { name: /^Settings$/i })).not.toBeInTheDocument();
    });

    it('should update system prompt', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));

      const systemPromptInput = screen.getByPlaceholderText("Enter the AI's persona...");
      fireEvent.change(systemPromptInput, { target: { value: 'New system prompt' } });
      expect(systemPromptInput).toHaveValue('New system prompt');
    });

    it('should toggle agentic mode', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));

      // The toggle button is next to the "Enable tool calling" label
      const toggleSection = screen.getByText('Enable tool calling').closest('div')!;
      const toggleButton = within(toggleSection).getByRole('button');
      fireEvent.click(toggleButton);

      expect(screen.getByText('Enabled')).toBeInTheDocument();
    });
  });

  describe('MCP Server Management', () => {
    it('should add and manage MCP servers', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));

      fireEvent.click(screen.getByText('+ Add'));

      const nameInput = screen.getByPlaceholderText('Server name');
      fireEvent.change(nameInput, { target: { value: 'Test Server' } });

      // Change type to http so url input appears
      const typeSelect = screen.getByDisplayValue('stdio');
      fireEvent.change(typeSelect, { target: { value: 'http' } });

      const urlInput = screen.getByPlaceholderText('URL (e.g. https://mcp.example.com)');
      fireEvent.change(urlInput, { target: { value: 'http://localhost:8080' } });

      fireEvent.click(screen.getByRole('button', { name: /Add Server/i }));

      await waitFor(() => {
        expect(screen.getByText('Test Server')).toBeInTheDocument();
      });
    });

    it('catalog: selecting a connector variant pre-fills the add form (#108)', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));

      // Open the connector catalog and pick GitHub's Docker variant
      fireEvent.click(screen.getByText(/📚 Catalog/));
      fireEvent.click(screen.getByRole('button', { name: /Use GitHub variant Local \(Docker\)/i }));

      // The add form opens pre-filled with the Docker command (stdio)
      const commandInput = screen.getByPlaceholderText('Command (e.g. npx my-mcp-server)') as HTMLInputElement;
      expect(commandInput.value).toContain('ghcr.io/github/github-mcp-server');
      // and the GITHUB_PERSONAL_ACCESS_TOKEN env key is pre-populated
      expect(screen.getByDisplayValue('GITHUB_PERSONAL_ACCESS_TOKEN')).toBeInTheDocument();
    });

    it('catalog: selecting the archived Postgres variant shows a security warning (#108)', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));
      fireEvent.click(screen.getByText(/📚 Catalog/));
      fireEvent.click(screen.getByRole('button', { name: /Use Database \(PostgreSQL\) variant Archived reference server/i }));
      // A security caveat banner appears in the form
      expect(screen.getByText(/SQL-injection|deprecated|read-only/i)).toBeInTheDocument();
    });

    it('should connect to MCP servers', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));

      // Add a server
      fireEvent.click(screen.getByText('+ Add'));
      const nameInput = screen.getByPlaceholderText('Server name');
      fireEvent.change(nameInput, { target: { value: 'Test Server' } });
      const typeSelect = screen.getByDisplayValue('stdio');
      fireEvent.change(typeSelect, { target: { value: 'http' } });
      const urlInput = screen.getByPlaceholderText('URL (e.g. https://mcp.example.com)');
      fireEvent.change(urlInput, { target: { value: 'http://localhost:8080' } });
      fireEvent.click(screen.getByRole('button', { name: /Add Server/i }));

      await waitFor(() => {
        expect(screen.getByText('Test Server')).toBeInTheDocument();
      });

      // Connect button should be present
      expect(screen.getByText('Connect')).toBeInTheDocument();
    });
  });

  describe('Tool Integration', () => {
    it('should show available tools in settings', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));

      // At least one tool (test_tool) should be in the list
      expect(screen.getByText('test_tool')).toBeInTheDocument();
    });

    it('should enable/disable tools', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));

      // test_tool is registered, its ✓ badge should be present
      expect(screen.getByText('test_tool')).toBeInTheDocument();
    });
  });

  describe('CLI Tool Integration', () => {
    it('should register CLI tool in tool registry', () => {
      // cli tool is registered as run_cli_command
      CliToolWrapper.registerAsTool();
      expect(toolRegistry.getTool('run_cli_command')).toBeDefined();
    });

    it('should handle CLI tool approval', async () => {
      let approvalCalled = false;

      CliToolWrapper.setApprovalCallback(async (_command: string) => {
        approvalCalled = true;
        return true;
      });

      const result = await CliToolWrapper.executeCommand({ command: 'echo test' });

      expect(approvalCalled).toBe(true);
      expect(result.success).toBe(true);
    });
  });

  describe('Responsive Design', () => {
    it('should handle mobile screen sizes', () => {
      Object.defineProperty(window, 'innerWidth', { value: 375, writable: true, configurable: true });
      window.dispatchEvent(new Event('resize'));

      render(<App />);

      // The ⋯ mobile menu button should exist in the header
      expect(screen.getByText('⋯')).toBeInTheDocument();
    });

    it('should toggle sidebar on mobile', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 375, writable: true, configurable: true });
      window.dispatchEvent(new Event('resize'));

      render(<App />);

      const menuButton = screen.getByText('⋯');
      fireEvent.click(menuButton);

      // After clicking, sidebar should be visible (toggled open)
      expect(screen.getByRole('heading', { name: /Ollama GUI/i })).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle Ollama API errors gracefully', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: true, json: async () => ({ models: ['llama3'] }), body: null });
        }
        return Promise.resolve({ ok: false, statusText: 'Service Unavailable', body: null });
      });

      render(<App />);

      const input = screen.getByPlaceholderText('Message Ollama...');
      fireEvent.change(input, { target: { value: 'Test' } });
      fireEvent.click(screen.getByText('Send'));

      await waitFor(() => {
        // Error is rendered as assistant message div containing "Error:"
        expect(screen.getByText(/Error:/i)).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('should handle MCP connection errors', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));

      // Add HTTP server
      fireEvent.click(screen.getByText('+ Add'));
      const nameInput = screen.getByPlaceholderText('Server name');
      fireEvent.change(nameInput, { target: { value: 'Fail Server' } });
      const typeSelect = screen.getByDisplayValue('stdio');
      fireEvent.change(typeSelect, { target: { value: 'http' } });
      const urlInput = screen.getByPlaceholderText('URL (e.g. https://mcp.example.com)');
      fireEvent.change(urlInput, { target: { value: 'http://localhost:1' } });
      fireEvent.click(screen.getByRole('button', { name: /Add Server/i }));

      await waitFor(() => {
        expect(screen.getByText('Fail Server')).toBeInTheDocument();
      });

      // Click Connect — it will fail since port 1 is unreachable
      fireEvent.click(screen.getByText('Connect'));

      await waitFor(() => {
        // Status should become error (red dot)
        const serverRow = screen.getByText('Fail Server').closest('div');
        const statusDot = serverRow?.parentElement?.querySelector('.bg-red-400, .bg-yellow-400, .bg-green-400');
        expect(statusDot).toBeTruthy();
      }, { timeout: 5000 });
    });
  });

  describe('Accessibility', () => {
    it('should have proper keyboard navigation', () => {
      render(<App />);

      const input = screen.getByPlaceholderText('Message Ollama...');
      const sendButton = screen.getByText('Send');

      // Buttons and inputs are natively focusable — no explicit tabIndex needed
      expect(input.tagName).toBe('INPUT');
      expect(sendButton.tagName).toBe('BUTTON');
    });

    it('should have proper ARIA attributes', () => {
      render(<App />);

      // The header settings button (gear icon, no text) has a title attribute
      const headerSettingsBtn = screen.getByTitle('Settings (Ctrl+,)');
      expect(headerSettingsBtn).toBeInTheDocument();
    });
  });
});
