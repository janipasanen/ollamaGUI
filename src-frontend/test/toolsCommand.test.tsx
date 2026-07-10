import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { runCommand } from '../services/commands';
import { toolRegistry } from '../services/tools';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  // Pre-register deterministic tools so /tools has content regardless of the
  // async init effect's timing in jsdom.
  toolRegistry.registerTool({ name: 'read_file', description: 'read a file', readOnly: true, parameters: { type: 'object', properties: {} }, execute: async () => ({}) });
  toolRegistry.registerTool({ name: 'run_shell_command', description: 'run a shell command', parameters: { type: 'object', properties: {} }, execute: async () => ({}) });
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  toolRegistry.unregisterTool('read_file');
  toolRegistry.unregisterTool('run_shell_command');
});

describe('/tools slash command (#399)', () => {
  it('runCommand parses /tools into the tools builtin action', () => {
    const result = runCommand('/tools');
    expect(result.kind).toBe('builtin');
    expect((result as { action: string }).action).toBe('tools');
  });

  it('lists registered tools with an enabled count in the status banner', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/tools' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    // Banner shape: "Tools: <on>/<total> enabled — …"
    await waitFor(() => {
      const statuses = screen.queryAllByRole('status');
      const banner = statuses.find(el => /Tools: \d+\/\d+ enabled/.test(el.textContent ?? ''));
      expect(banner).toBeDefined();
      expect(banner!.textContent).toContain('read_file');
    }, { timeout: 3000 });
  });
});
