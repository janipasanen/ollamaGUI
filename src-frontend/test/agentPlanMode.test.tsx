/**
 * Plan-mode gating (#408, Codex/Claude plan-mode parity): in plan autonomy,
 * the agent may publish a plan (read-only `update_plan`) freely, but mutating
 * tools are blocked until the user approves the plan. After approval, mutating
 * tools auto-approve for the rest of the run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { toolRegistry } from '../services/tools';

function toolCall(name: string, args: Record<string, unknown> = {}) {
  return JSON.stringify({
    message: {
      role: 'assistant', content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    },
  });
}
const finalLine = (content: string) => JSON.stringify({ message: { role: 'assistant', content }, done: true });

function streamOnce(text: string) {
  const reader = { read: vi.fn() };
  reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from(text) });
  reader.read.mockResolvedValueOnce({ done: true, value: undefined });
  return Promise.resolve({ ok: true, body: { getReader: () => reader } });
}

const PLAN = [{ step: 'Do the thing', status: 'in_progress' }];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('ollama_gui_agent_autonomy', JSON.stringify({
    level: 'plan', maxIterations: 20, readOnly: false, smartApprove: false,
  }));
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  toolRegistry.registerTool({
    name: 'mutate_tool', description: 'mutates state', parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
  });
});

afterEach(() => {
  toolRegistry.unregisterTool('mutate_tool');
});

describe('Plan-mode gating (#408)', () => {
  it('blocks mutating tools until the plan is approved, then auto-approves the run', async () => {
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        chatCalls++;
        if (chatCalls === 1) return streamOnce(toolCall('update_plan', { plan: PLAN }));
        if (chatCalls === 2) return streamOnce(toolCall('mutate_tool'));
        if (chatCalls === 3) return streamOnce(toolCall('mutate_tool'));
        return streamOnce(finalLine('plan done'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle tool calling' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });

    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // update_plan (read-only) runs without prompting; the first mutating tool
    // triggers the plan-approval modal (NOT the per-tool approval modal).
    await waitFor(() => {
      expect(screen.getByText(/Approve plan to begin execution/i)).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(screen.queryByText(/Agent wants to use a tool/i)).not.toBeInTheDocument();

    // Approve the plan.
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    // The run completes; the second mutating tool was auto-approved (no modal).
    await waitFor(() => {
      expect(screen.getByText(/plan done/i)).toBeInTheDocument();
    }, { timeout: 8000 });
    expect(screen.queryByText(/Approve plan to begin execution/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Agent wants to use a tool/i)).not.toBeInTheDocument();
    expect(chatCalls).toBe(4);
  }, 30000);

  it('Deny blocks the mutating tool and keeps the plan un-approved', async () => {
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        chatCalls++;
        if (chatCalls === 1) return streamOnce(toolCall('update_plan', { plan: PLAN }));
        if (chatCalls === 2) return streamOnce(toolCall('mutate_tool'));
        return streamOnce(finalLine('plan denied'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle tool calling' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });

    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText(/Approve plan to begin execution/i)).toBeInTheDocument();
    }, { timeout: 5000 });

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    // Tool blocked; the run continues to a final answer.
    await waitFor(() => {
      expect(screen.getByText(/plan denied/i)).toBeInTheDocument();
    }, { timeout: 8000 });
    expect(screen.queryByText(/Approve plan to begin execution/i)).not.toBeInTheDocument();
  }, 30000);
});

describe('Plan-mode edit-before-approve (#409)', () => {
  it('lets the user edit plan steps before approving, and persists the edits', async () => {
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        chatCalls++;
        if (chatCalls === 1) return streamOnce(toolCall('update_plan', { plan: [{ step: 'Original step', status: 'in_progress' }] }));
        if (chatCalls === 2) return streamOnce(toolCall('mutate_tool'));
        return streamOnce(finalLine('edited done'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle tool calling' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });

    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText(/Approve plan to begin execution/i)).toBeInTheDocument();
    }, { timeout: 5000 });

    // Enter edit mode and rewrite the step.
    fireEvent.click(screen.getByRole('button', { name: 'Edit plan' }));
    const textarea = screen.getByLabelText('Edit plan step 1') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Edited step' } });

    // Approve — the edited plan is persisted to the plan panel.
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(screen.getByText(/edited done/i)).toBeInTheDocument();
    }, { timeout: 8000 });

    // The plan panel now shows the edited step (not the original).
    const planPanel = screen.getByLabelText('Task plan');
    expect(planPanel.textContent).toContain('Edited step');
    expect(planPanel.textContent).not.toContain('Original step');
  }, 30000);
});

describe('Cancel during plan-approval wait (#410)', () => {
  it('Stop unblocks the awaited approval and closes the modal without hanging', async () => {
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        chatCalls++;
        if (chatCalls === 1) return streamOnce(toolCall('update_plan', { plan: PLAN }));
        if (chatCalls === 2) return streamOnce(toolCall('mutate_tool'));
        return streamOnce(finalLine('should not reach'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle tool calling' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });

    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText(/Approve plan to begin execution/i)).toBeInTheDocument();
    }, { timeout: 5000 });

    // Click the explicit Stop button while the run is blocked on approval.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel generation' }));

    // The modal closes and generation ends (Send button returns) — no hang.
    await waitFor(() => {
      expect(screen.queryByText(/Approve plan to begin execution/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    }, { timeout: 5000 });
    // The loop broke at the abort guard before issuing a third fetch.
    expect(chatCalls).toBe(2);
  }, 30000);
});
