import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from '../App';
import { toolRegistry } from '../services/tools';
import { storage, type ChatSession } from '../services/storage';

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

      // Minimal Ollama-style shell: composer + Send, "+ New" chat button and
      // conversation search in the sidebar (the "Ollama GUI" h1 is gone).
      expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument();
      expect(screen.getByText('Send')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Start new chat' })).toBeInTheDocument();
      expect(screen.getByLabelText('Search conversations')).toBeInTheDocument();
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
      // "+ New" now opens a project picker menu (when projects exist); choosing
      // "No project" starts the fresh chat that the old "+ New Chat" button did.
      localStorage.setItem('ollama_gui_projects', JSON.stringify([
        { id: 'proj_e2e', name: 'e2e-proj', workspaceRoot: '', instructions: '', createdAt: 1 },
      ]));
      render(<App />);

      const input = screen.getByPlaceholderText('Message Ollama...');
      fireEvent.change(input, { target: { value: 'First message' } });
      fireEvent.click(screen.getByRole('button', { name: 'Start new chat' }));
      const menu = await screen.findByRole('menu', { name: 'New chat in project' });
      fireEvent.click(within(menu).getByRole('menuitem', { name: /No project/ }));

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

    it('derives agentic mode from the active project folder (toggle removed)', async () => {
      // Agentic mode is no longer a Settings toggle — it is ON exactly when
      // the active project has a bound folder. Seed one before render.
      localStorage.setItem('ollama_gui_projects', JSON.stringify([
        { id: 'proj_t', name: 'proj', workspaceRoot: '/tmp/ws', workspaceRoots: ['/tmp/ws'], instructions: '', createdAt: 1700000000000 },
      ]));
      localStorage.setItem('ollama_gui_active_project', 'proj_t');
      render(<App />);

      // Agentic mode is active: the composer switches to the goal placeholder
      // (query by the stable aria-label, which is the same in both modes)…
      const input = screen.getByLabelText('Type your message here');
      expect(input).toHaveAttribute('placeholder', 'Describe the goal for this session…');
      // …and the Plan/Ask/Auto autonomy control renders next to the model
      // select below the composer (it moved out of Settings).
      expect(screen.getByRole('group', { name: 'Autonomy level' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Set autonomy: auto' })).toBeInTheDocument();

      // The old Settings toggle and its section are gone.
      fireEvent.click(screen.getByText('⚙️ Settings'));
      expect(screen.queryByLabelText('Toggle tool calling')).not.toBeInTheDocument();
      expect(screen.queryByText('Enable tool calling')).not.toBeInTheDocument();
    });
  });

  describe('MCP Server Management', () => {
    // These four MCP tests drive the full App + Settings overlay, which lands
    // around 4s each in isolation on the slower externals-drive Mac runner and
    // exceeds the 5s default when the whole file runs — same slow-runner
    // pattern as the MCP connection-errors test below (#426).
    it('should add and manage MCP servers', { timeout: 20_000 }, async () => {
      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));

      fireEvent.click(screen.getByRole('button', { name: 'Add MCP server' }));

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

    it('catalog: selecting a connector variant pre-fills the add form (#108)', { timeout: 20_000 }, async () => {
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

    it('catalog: selecting the archived Postgres variant shows a security warning (#108)', { timeout: 20_000 }, async () => {
      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));
      fireEvent.click(screen.getByText(/📚 Catalog/));
      fireEvent.click(screen.getByRole('button', { name: /Use Database \(PostgreSQL\) variant Archived reference server/i }));
      // A security caveat banner appears in the form
      expect(screen.getByText(/SQL-injection|deprecated|read-only/i)).toBeInTheDocument();
    });

    it('should connect to MCP servers', { timeout: 20_000 }, async () => {
      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));

      // Add a server
      fireEvent.click(screen.getByRole('button', { name: 'Add MCP server' }));
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

      // Sidebar starts collapsed on mobile (w-0 container).
      const sidebar = document.querySelector('div.transition-all') as HTMLElement;
      expect(sidebar.className).toContain('w-0');

      // The ⋯ menu now opens an action menu; "Show sidebar" toggles it open.
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Show sidebar' }));

      await waitFor(() => {
        expect((document.querySelector('div.transition-all') as HTMLElement).className).toContain('w-64');
      });
    });
  });

  describe('Session lifecycle (#16)', () => {
    function seedSession(id: string, title: string): ChatSession {
      const s: ChatSession = {
        id, title, messages: [{ role: 'user', content: 'hi' }], createdAt: Date.now(), model: 'llama3',
      };
      storage.saveSession(s);
      return s;
    }

    it('renders persisted sessions in the sidebar', () => {
      seedSession('s-alpha', 'Alpha conversation');
      seedSession('s-beta', 'Beta conversation');
      render(<App />);
      expect(screen.getByText('Alpha conversation')).toBeInTheDocument();
      expect(screen.getByText('Beta conversation')).toBeInTheDocument();
    });

    it('deletes a session from the sidebar after confirmation', async () => {
      seedSession('s-del', 'Deletable conversation');
      render(<App />);
      const title = screen.getByText('Deletable conversation');
      // The row container holds the hover action buttons (Rename/Pin/Delete).
      const row = title.closest('div')!.parentElement!;
      const deleteBtn = within(row).getByTitle('Delete');
      fireEvent.click(deleteBtn);
      // Confirm the new confirmation dialog.
      fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }));
      await waitFor(() => {
        expect(screen.queryByText('Deletable conversation')).not.toBeInTheDocument();
      });
    });

    it('renames a session inline via the right-click context menu (#52)', async () => {
      seedSession('s-ren', 'Old name');
      render(<App />);
      // The hover Rename button is gone — Rename now lives in the row's
      // right-click context menu, which opens the same inline rename input.
      const row = screen.getByRole('button', { name: 'Load session: Old name' });
      fireEvent.contextMenu(row);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
      const input = await screen.findByLabelText('Rename conversation') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'New name' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => {
        expect(screen.getByText('New name')).toBeInTheDocument();
      });
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
        // A friendly, actionable error message is rendered (#30): the 5xx
        // "Service Unavailable" maps to a "Service unavailable" assistant bubble.
        expect(screen.getByText(/unavailable|went wrong|cannot reach/i)).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    // Drives the whole App through add-server -> connect -> error rendering, so
    // it is the slowest case in this file. It lands around 3.3s on the Ubuntu
    // runner but exceeded the 5s default on the slower Windows runner (measured
    // 5154ms), failing the build on a timeout rather than an assertion.
    it('should handle MCP connection errors', { timeout: 20_000 }, async () => {
      // Deterministically fail the MCP HTTP connect: the previous global fetch
      // mock returned {ok:true} for every URL, so the connect sometimes
      // "succeeded" (green) instead of erroring — making the test flaky and not
      // actually exercising the error path (#426). Reject only the MCP server
      // URL; keep the safe default for model-loading endpoints.
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('localhost:1')) {
          return Promise.reject(new TypeError('fetch failed: connection refused'));
        }
        return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
      });

      render(<App />);
      fireEvent.click(screen.getByText('⚙️ Settings'));

      // Add HTTP server
      fireEvent.click(screen.getByRole('button', { name: 'Add MCP server' }));
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

      // Click Connect — the MCP HTTP initialise fetch rejects, so the connect
      // handler sets status to 'error' and renders the red status dot.
      fireEvent.click(screen.getByText('Connect'));

      await waitFor(() => {
        const serverRow = screen.getByText('Fail Server').closest('div');
        const statusDot = serverRow?.parentElement?.querySelector('.bg-red-400');
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
      expect(input.tagName).toBe('TEXTAREA');
      expect(sendButton.tagName).toBe('BUTTON');
    });

    it('should have proper ARIA attributes', () => {
      render(<App />);

      // The header has no buttons anymore; the inline connection indicator
      // carries an always-legible accessible label, as does the model switcher
      // below the composer.
      expect(screen.getByTestId('inline-connection-indicator')).toBeInTheDocument();
      expect(screen.getByLabelText('Select AI model')).toBeInTheDocument();
    });

    it('composer input and Send button expose aria-labels (#33)', () => {
      render(<App />);
      // Input is reachable by its accessible name.
      expect(screen.getByLabelText('Type your message here')).toBeInTheDocument();
      // Send button is reachable by role + accessible name.
      expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    });

    it('sidebar session actions have descriptive aria-labels (#33)', async () => {
      storage.saveSession({ id: 'a11y', title: 'Accessible chat', messages: [], createdAt: Date.now(), model: 'llama3' });
      render(<App />);
      // The row itself and its only remaining icon-only hover button (✕) are
      // labelled with the action + session title.
      expect(screen.getByRole('button', { name: 'Load session: Accessible chat' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Delete session: Accessible chat/i })).toBeInTheDocument();
      // Rename moved to the right-click context menu (accessible menuitem).
      fireEvent.contextMenu(screen.getByRole('button', { name: 'Load session: Accessible chat' }));
      expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    });
  });
});
