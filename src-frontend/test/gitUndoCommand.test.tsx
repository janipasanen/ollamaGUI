import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { runCommand } from '../services/commands';
import { gitReset, _mocks as gitMocks } from '../services/git';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  gitMocks.invoke = null;
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  gitMocks.invoke = null;
});

describe('gitReset service (#402)', () => {
  it('calls the git_reset Tauri command with cwd + n', async () => {
    let capturedCmd = '';
    let capturedArgs: Record<string, unknown> = {};
    gitMocks.invoke = async (cmd, args) => { capturedCmd = cmd; capturedArgs = args ?? {}; return undefined; };
    await gitReset('/ws', 1);
    expect(capturedCmd).toBe('git_reset');
    expect(capturedArgs).toMatchObject({ cwd: '/ws', n: 1 });
  });

  it('defaults n to 1', async () => {
    let captured: Record<string, unknown> = {};
    gitMocks.invoke = async (_cmd, args) => { captured = args ?? {}; return undefined; };
    await gitReset('/ws');
    expect(captured).toMatchObject({ n: 1 });
  });
});

describe('/gitundo slash command (#402)', () => {
  it('runCommand parses /gitundo into the gitundo builtin action', () => {
    const result = runCommand('/gitundo');
    expect(result.kind).toBe('builtin');
    expect((result as { action: string }).action).toBe('gitundo');
  });

  it('shows a status banner after running /gitundo', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/gitundo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => {
      const statuses = screen.queryAllByRole('status');
      const banner = statuses.find(el => /Reverted auto-commit|Could not revert/.test(el.textContent ?? ''));
      expect(banner).toBeDefined();
    }, { timeout: 3000 });
  });
});
