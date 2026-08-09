/**
 * Tool approval "Allow for session" (#406, Codex/Claude "don't ask again"
 * parity): in ask autonomy mode, approving a mutating tool "for session"
 * auto-approves subsequent calls to the same tool without re-prompting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { toolRegistry } from '../services/tools';

const toolCallLine = (name: string) => JSON.stringify({
  message: {
    role: 'assistant', content: '',
    tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: '{}' } }],
  },
});
const finalLine = (content: string) => JSON.stringify({ message: { role: 'assistant', content }, done: true });

function streamOnce(text: string) {
  const reader = { read: vi.fn() };
  reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from(text) });
  reader.read.mockResolvedValueOnce({ done: true, value: undefined });
  return Promise.resolve({ ok: true, body: { getReader: () => reader } });
}

beforeEach(() => {
  localStorage.clear();
  // ask level → mutating tools prompt (read-only tools never prompt).
  localStorage.setItem('ollama_gui_agent_autonomy', JSON.stringify({
    level: 'ask', maxIterations: 20, readOnly: false,
  }));
  // Agentic mode is derived: an active project with a bound folder turns tools on.
  localStorage.setItem('ollama_gui_projects', JSON.stringify([
    { id: 'proj_t', name: 'proj', workspaceRoot: '/tmp/ws', workspaceRoots: ['/tmp/ws'], instructions: '', createdAt: 1700000000000 },
  ]));
  localStorage.setItem('ollama_gui_active_project', 'proj_t');
  // The agentic toolFilter (#549 rank 3) sends only core + MCP + custom tool
  // names; anything else is blocked at execution time. Listing mutate_tool as
  // a custom tool puts its (bare) name in the filter — the executable stub is
  // registered directly on the registry below.
  localStorage.setItem('custom_tools', JSON.stringify([
    { id: 'ct_mutate', name: 'mutate_tool', description: 'mutates state', parameters: { type: 'object', properties: {} }, code: 'return { ok: true };', enabled: true },
  ]));
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  toolRegistry.registerTool({
    name: 'custom__mutate_tool', description: 'mutates state', parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
  });
});

afterEach(() => {
  toolRegistry.unregisterTool('custom__mutate_tool');
});

describe('Tool approval "Allow for session" (#406)', () => {
  it('auto-approves subsequent calls to the same tool after "Allow for session"', async () => {
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        chatCalls++;
        if (chatCalls === 1) return streamOnce(toolCallLine('custom__mutate_tool'));
        if (chatCalls === 2) return streamOnce(toolCallLine('custom__mutate_tool'));
        return streamOnce(finalLine('all done'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);

    // Agentic mode already on via the bound project; type into the composer.
    fireEvent.change(screen.getByLabelText('Type your message here'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // First tool call → approval modal appears (with the Allow-for-session
    // button). The tool name also appears in the "Calling tool" message, so
    // match the heading + button rather than the bare name.
    await waitFor(() => {
      expect(screen.getByText(/Agent wants to use a tool/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Allow for session' })).toBeInTheDocument();
    }, { timeout: 5000 });

    // Approve "for session".
    fireEvent.click(screen.getByRole('button', { name: 'Allow for session' }));

    // The second call to the same tool must NOT re-show the approval modal,
    // and the run completes with the final answer.
    await waitFor(() => {
      expect(screen.getByText(/all done/i)).toBeInTheDocument();
    }, { timeout: 15000 }); // slow-CI headroom: windows-latest exceeded 8s under load

    expect(screen.queryByText(/Agent wants to use a tool/i)).not.toBeInTheDocument();
    expect(chatCalls).toBe(3);
  }, 30000);
});

describe('Tool approval keyboard shortcuts (#407)', () => {
  it('Escape denies the tool call (resolves false)', async () => {
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        chatCalls++;
        if (chatCalls === 1) return streamOnce(toolCallLine('custom__mutate_tool'));
        return streamOnce(finalLine('denied and done'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);

    // Agentic mode already on via the bound project; type into the composer.
    fireEvent.change(screen.getByLabelText('Type your message here'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText(/Agent wants to use a tool/i)).toBeInTheDocument();
    }, { timeout: 5000 });

    // Escape = Deny.
    fireEvent.keyDown(window, { key: 'Escape' });

    // Modal closes and the run continues to a final answer.
    await waitFor(() => {
      expect(screen.queryByText(/Agent wants to use a tool/i)).not.toBeInTheDocument();
      expect(screen.getByText(/denied and done/i)).toBeInTheDocument();
    }, { timeout: 15000 }); // slow-CI headroom: windows-latest exceeded 8s under load
  }, 30000);

  it('"A" approves the tool for the session (auto-approves the next call)', async () => {
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        chatCalls++;
        if (chatCalls === 1) return streamOnce(toolCallLine('custom__mutate_tool'));
        if (chatCalls === 2) return streamOnce(toolCallLine('custom__mutate_tool'));
        return streamOnce(finalLine('a-key done'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);

    // Agentic mode already on via the bound project; type into the composer.
    fireEvent.change(screen.getByLabelText('Type your message here'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText(/Agent wants to use a tool/i)).toBeInTheDocument();
    }, { timeout: 5000 });

    // "a" = Allow for session.
    fireEvent.keyDown(window, { key: 'a' });

    // Second call auto-approved; run completes without re-prompting.
    await waitFor(() => {
      expect(screen.getByText(/a-key done/i)).toBeInTheDocument();
    }, { timeout: 15000 }); // slow-CI headroom: windows-latest exceeded 8s under load
    expect(screen.queryByText(/Agent wants to use a tool/i)).not.toBeInTheDocument();
    expect(chatCalls).toBe(3);
  }, 30000);
});
