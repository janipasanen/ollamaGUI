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
  // The real @tauri-apps/api invoke(cmd, args) resolves a Promise only when the
  // backend calls the result callback. transformCallback() stores that resolver
  // under window[`_<identifier>`] (e.g. `window._1`) and passes the numeric id
  // to __TAURI_IPC__. A plain `async () => ({...})` never invokes it, so
  // invoke() hangs forever on the approve path (the deny path returns before
  // any invoke) — wire the seam to call the registered resolver with a
  // successful run_cli result instead.
  (window as any).__TAURI_IPC__ = (msg: any) => {
    const resolver = (window as any)[`_${msg.callback}`];
    if (typeof resolver === 'function') {
      resolver({ stdout: 'ok', stderr: '', exit_code: 0, timed_out: false });
    }
  };
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  _cliMocks.invoke = null;
  delete (window as any).__TAURI_IPC__;
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
    // The approval keydown listener is attached in a useEffect that runs AFTER
    // the modal paints. Retry the keydown inside waitFor so it lands once the
    // listener is ready — fixes a race that flaked ~20% of runs (#425).
    await waitFor(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(screen.queryByText('Command Approval Required')).not.toBeInTheDocument();
    }, { timeout: 3000 });
    const result = await promise;
    expect(result).toMatchObject({ exit_code: 0 });
  });

  it('Escape denies the command', async () => {
    render(<App />);
    await waitFor(() => expect(toolRegistry.getTool('run_shell_command')).toBeDefined(), { timeout: 3000 });
    const promise = toolRegistry.getTool('run_shell_command')!.execute({ command: 'echo esc-test' });
    await waitFor(() => expect(screen.getByText('Command Approval Required')).toBeInTheDocument(), { timeout: 3000 });
    // Retry the keydown until the listener (attached in a post-paint effect) is
    // ready and the modal closes (#425 race fix).
    await waitFor(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByText('Command Approval Required')).not.toBeInTheDocument();
    }, { timeout: 3000 });
    const result = await promise;
    expect(result).toMatchObject({ error: 'Command denied by user.' });
  });

  it('A always-approves and adds the command binary to the allowlist', async () => {
    render(<App />);
    await waitFor(() => expect(toolRegistry.getTool('run_shell_command')).toBeDefined(), { timeout: 3000 });
    const promise = toolRegistry.getTool('run_shell_command')!.execute({ command: 'echo always-test' });
    await waitFor(() => expect(screen.getByText('Command Approval Required')).toBeInTheDocument(), { timeout: 3000 });
    // Retry the keydown until the post-paint effect listener is ready and the
    // modal closes (#425 race fix). Re-firing is safe: resolve() and
    // cliAllowlist.add() are idempotent.
    await waitFor(() => {
      fireEvent.keyDown(window, { key: 'a' });
      expect(screen.queryByText('Command Approval Required')).not.toBeInTheDocument();
    }, { timeout: 3000 });
    const result = await promise;
    expect(result).toMatchObject({ exit_code: 0 });
    // "Always allow" is binary-level now: it allowlists the first token
    // ('echo'), not the full command string.
    expect(cliAllowlist.has('echo')).toBe(true);
  });
});
