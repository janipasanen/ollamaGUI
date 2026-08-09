/**
 * Agentic "Continue past max-iterations" UI (#403): after the agent stops at
 * maxIterations a "Continue agent" button appears; clicking it re-runs the
 * agentic stream with the current context (a fresh batch of tool iterations).
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

function streamOnce(text: string) {
  const reader = { read: vi.fn() };
  reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from(text) });
  reader.read.mockResolvedValueOnce({ done: true, value: undefined });
  return Promise.resolve({ ok: true, body: { getReader: () => reader } });
}

beforeEach(() => {
  localStorage.clear();
  // Auto level + low cap so the loop hits maxIterations quickly.
  localStorage.setItem('ollama_gui_agent_autonomy', JSON.stringify({
    level: 'auto', maxIterations: 2, readOnly: false,
  }));
  // Agentic mode is derived: an active project with a bound folder turns tools on.
  localStorage.setItem('ollama_gui_projects', JSON.stringify([
    { id: 'proj_t', name: 'proj', workspaceRoot: '/tmp/ws', workspaceRoots: ['/tmp/ws'], instructions: '', createdAt: 1700000000000 },
  ]));
  localStorage.setItem('ollama_gui_active_project', 'proj_t');
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
  toolRegistry.registerTool({
    name: 'loop_tool', description: 'loop', parameters: { type: 'object', properties: {} },
    execute: async () => ({ again: true }),
  });
});

afterEach(() => {
  toolRegistry.unregisterTool('loop_tool');
});

describe('Continue agent past max-iterations (#403)', () => {
  it('shows the Continue agent button after a max-iterations stop and re-runs the stream on click', async () => {
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        chatCalls++;
        // Always return a tool call so the loop exhausts maxIterations both times.
        return streamOnce(toolCallLine('loop_tool'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);
    // Agentic mode is already active via the folder-bound project (beforeEach).
    fireEvent.change(screen.getByLabelText('Type your message here'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // First agentic run: 2 iterations (maxIterations=2) then the stop warning.
    await waitFor(() => {
      expect(chatCalls).toBeGreaterThanOrEqual(2);
    }, { timeout: 8000 });

    await waitFor(() => {
      const btn = screen.queryByRole('button', { name: 'Continue agent' });
      expect(btn).not.toBeNull();
    }, { timeout: 8000 });

    const firstRunCalls = chatCalls;
    expect(firstRunCalls).toBe(2);

    // Click Continue — should re-invoke the agentic stream.
    fireEvent.click(screen.getByRole('button', { name: 'Continue agent' }));

    await waitFor(() => {
      expect(chatCalls).toBeGreaterThan(firstRunCalls);
    }, { timeout: 8000 });
  }, 30000);
});
