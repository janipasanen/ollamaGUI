import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { toolRegistry, cliAllowlist, _cliMocks } from '../services/tools';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  cliAllowlist.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/api/chat')) {
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"ok"}}\n') })
              .mockResolvedValueOnce({ done: true, value: undefined }),
          }),
        },
      } as any;
    }
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
  // Provide a Tauri invoke stub so run_shell_command can execute after approval.
  (window as any).__TAURI_INTERNALS__ = {
    invoke: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exit_code: 0, timed_out: false }),
  };
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  _cliMocks.invoke = null;
  cliAllowlist.clear();
  delete (window as any).__TAURI_INTERNALS__;
});

// ── Tab-to-indent (#360) ──────────────────────────────────────────────────────

describe('Tab-to-indent in the chat composer (#360)', () => {
  it('Tab inserts two spaces at the caret position', () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'hello' } });
    composer.selectionStart = 5;
    composer.selectionEnd = 5;
    fireEvent.keyDown(composer, { key: 'Tab' });
    expect(composer.value).toBe('hello  ');
  });

  it('Shift+Tab outdents two leading spaces from the current line', () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '  hi' } });
    composer.selectionStart = 4;
    composer.selectionEnd = 4;
    fireEvent.keyDown(composer, { key: 'Tab', shiftKey: true });
    expect(composer.value).toBe('hi');
  });

  it('Tab does not indent when slash-command suggestions are open', () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/m' } });
    fireEvent.keyDown(composer, { key: 'Tab' });
    // When suggestions are open, Tab selects a suggestion instead of indenting.
    // The key assertion: no two-space indent was inserted.
    expect(composer.value).not.toBe('/m  ');
  });
});

// ── Approval modal keyboard shortcuts (#361) ──────────────────────────────────

describe('CLI approval modal keyboard shortcuts (#361)', () => {
  it('Enter approves the command (Allow Once)', async () => {
    render(<App />);
    await waitFor(() => expect(toolRegistry.getTool('run_shell_command')).toBeDefined(), { timeout: 3000 });
    const promise = toolRegistry.getTool('run_shell_command')!.execute({ command: 'echo enter-test' });
    await waitFor(() => expect(screen.getByText('Command Approval Required')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.keyDown(window, { key: 'Enter' });
    const result = await promise;
    expect(result).toMatchObject({ exit_code: 0 });
    await waitFor(() => expect(screen.queryByText('Command Approval Required')).not.toBeInTheDocument());
  });

  it('Escape denies the command', async () => {
    render(<App />);
    await waitFor(() => expect(toolRegistry.getTool('run_shell_command')).toBeDefined(), { timeout: 3000 });
    const promise = toolRegistry.getTool('run_shell_command')!.execute({ command: 'echo esc-test' });
    await waitFor(() => expect(screen.getByText('Command Approval Required')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.keyDown(window, { key: 'Escape' });
    const result = await promise;
    expect(result).toMatchObject({ error: 'Command denied by user.' });
    await waitFor(() => expect(screen.queryByText('Command Approval Required')).not.toBeInTheDocument());
  });

  it('A always-approves and adds the command to the allowlist', async () => {
    render(<App />);
    await waitFor(() => expect(toolRegistry.getTool('run_shell_command')).toBeDefined(), { timeout: 3000 });
    const promise = toolRegistry.getTool('run_shell_command')!.execute({ command: 'echo always-test' });
    await waitFor(() => expect(screen.getByText('Command Approval Required')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.keyDown(window, { key: 'a' });
    const result = await promise;
    expect(result).toMatchObject({ exit_code: 0 });
    expect(cliAllowlist.has('echo always-test')).toBe(true);
    await waitFor(() => expect(screen.queryByText('Command Approval Required')).not.toBeInTheDocument());
  });
});
