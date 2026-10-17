import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { storage, type Project } from '../services/storage';
import { _mocks as gitMocks } from '../services/git';
import { _mocks as fileMocks } from '../services/fileTools';
import { _cliMocks } from '../services/tools';

let origFetch: typeof global.fetch;

function chatStreamResponse(content: string) {
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: Buffer.from(`{"message":{"content":${JSON.stringify(content)}}}\n`) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }),
    },
  } as any;
}

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/api/chat')) return chatStreamResponse('Fix parser bug');
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
  fileMocks.invoke = async (cmd: string) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'read_file') return '';
    return undefined;
  };
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  gitMocks.invoke = null;
  fileMocks.invoke = null;
  _cliMocks.invoke = null;
});

function sendCommand(cmd: string) {
  const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
  fireEvent.change(composer, { target: { value: cmd } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

function seedRepoProject() {
  const proj: Project = { id: 'repo-proj', name: 'Repo', workspaceRoot: '/ws/repo', instructions: '', createdAt: 1 };
  storage.saveProject(proj);
}

// ── /commit (#357) ────────────────────────────────────────────────────────────

describe('/commit stages all and commits with a generated message (#357)', () => {
  it('generates a message from the diff and commits', async () => {
    seedRepoProject();
    const gitInvoke = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === 'git_status') return { staged: [], unstaged: ['src/a.ts'], untracked: ['src/b.ts'] };
      if (cmd === 'git_diff') return { diff: 'diff --git a/src/a.ts …' };
      if (cmd === 'git_stage') return undefined;
      if (cmd === 'git_commit') return { hash: 'abc123' };
      return { success: true };
    });
    gitMocks.invoke = gitInvoke;

    render(<App />);
    fireEvent.click(await screen.findByText('📂 Repo'));

    sendCommand('/commit');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Committed abc123: Fix parser bug/), { timeout: 3000 });

    const commitCall = gitInvoke.mock.calls.find(c => c[0] === 'git_commit');
    expect(commitCall).toBeTruthy();
    expect(commitCall![1]).toMatchObject({ message: 'Fix parser bug' });
  });

  it('reports nothing to commit when the tree is clean', async () => {
    seedRepoProject();
    gitMocks.invoke = async (cmd: string) => {
      if (cmd === 'git_status') return { staged: [], unstaged: [], untracked: [] };
      return { success: true };
    };

    render(<App />);
    fireEvent.click(await screen.findByText('📂 Repo'));

    sendCommand('/commit');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Nothing to commit/), { timeout: 3000 });
  });

  it('refuses with no workspace', async () => {
    render(<App />);
    sendCommand('/commit');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/No workspace open/));
  });
});

// ── /tests (#359) ─────────────────────────────────────────────────────────────

describe('/tests runs the suite and feeds failures to the model (#359)', () => {
  it('reports success and does not disturb the model on exit 0', async () => {
    _cliMocks.invoke = async () => ({ stdout: 'all good', stderr: '', exit_code: 0, timed_out: false });
    render(<App />);
    sendCommand('/tests npm test');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Tests passed/), { timeout: 3000 });
    expect(screen.queryByText(/following tests are failing/i)).not.toBeInTheDocument();
  });

  it('feeds failures to the model on non-zero exit', async () => {
    _cliMocks.invoke = async () => ({ stdout: 'FAIL: foo', stderr: '', exit_code: 1, timed_out: false });
    render(<App />);
    sendCommand('/tests npm test');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Tests failed \(exit 1\)/), { timeout: 3000 });
    expect(await screen.findByText(/following tests are failing/i, { selector: 'p' })).toBeInTheDocument();
  });

  it('refuses with no command', async () => {
    render(<App />);
    sendCommand('/tests');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Usage: \/tests <command>/));
  });
});

// ── #569: /commit routes to the active model's own endpoint ─────────────
describe('/commit routes to the connection endpoint (#569)', () => {
  it('posts the generated commit message to an OpenAI connection /v1/chat/completions with the bare model name', async () => {
    // An OpenAI-compatible (LM Studio / vLLM) connection. The request must NOT
    // POST the commit-message generation to local Ollama, and must use the
    // bare model name (not the "conn-openai/qwen" selector id).
    localStorage.setItem('model_connections', JSON.stringify([
      { id: 'conn-openai', name: 'LM Studio', kind: 'openai', baseUrl: 'http://lm:1234', apiKey: 'secret-key', enabled: true },
    ]));
    seedRepoProject();

    const chatCalls: { url: string; body: any; headers?: Record<string, string> }[] = [];
    let localChatCalled = false;

    function openAiStream(content: string) {
      const reader = { read: vi.fn() as ReturnType<typeof vi.fn> };
      reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from(`data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}\n`) });
      reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('data: {"choices":[{"delta":{}}]}\n') });
      reader.read.mockResolvedValueOnce({ done: true, value: undefined });
      return Promise.resolve({ ok: true, body: { getReader: () => reader } });
    }

    global.fetch = vi.fn(async (url: unknown, opts: any) => {
      const u = String(url);
      if (u.includes('/v1/models')) return { ok: true, json: async () => ({ data: [{ id: 'qwen' }] }) } as any;
      if (u.includes('/v1/chat/completions')) {
        chatCalls.push({ url: u, body: JSON.parse(opts.body), headers: opts.headers as Record<string, string> });
        return openAiStream('Fix the parser.');
      }
      if (u.includes('/api/chat')) { localChatCalled = true; return chatStreamResponse('Fix the parser.'); }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    const gitInvoke = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === 'git_status') return { staged: [], unstaged: ['src/a.ts'], untracked: ['src/b.ts'] };
      if (cmd === 'git_diff') return { diff: 'diff --git a/src/a.ts …' };
      if (cmd === 'git_stage') return undefined;
      if (cmd === 'git_commit') return { hash: 'abc123' };
      return { success: true };
    });
    gitMocks.invoke = gitInvoke;

    render(<App />);
    fireEvent.click(await screen.findByText('📂 Repo'));

    const sel = screen.getByLabelText('Select AI model') as HTMLSelectElement;
    await waitFor(() =>
      expect(screen.getAllByRole('option').map(o => o.getAttribute('value'))).toContain('conn-openai/qwen'),
      { timeout: 5000 },
    );
    fireEvent.change(sel, { target: { value: 'conn-openai/qwen' } });
    await waitFor(() => expect(sel.value).toBe('conn-openai/qwen'), { timeout: 5000 });

    sendCommand('/commit');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Committed abc123: Fix the parser/), { timeout: 5000 });

    // The generation went to the connection's /v1/chat/completions, not local /api/chat.
    expect(localChatCalled).toBe(false);
    expect(chatCalls.length).toBeGreaterThan(0);
    const call = chatCalls[chatCalls.length - 1];
    expect(call.url).toContain('http://lm:1234/v1/chat/completions');
    // Bare model name, not the connection-scoped selector id.
    expect(call.body.model).toBe('qwen');
    expect(call.body.model).not.toBe('conn-openai/qwen');
    // Auth is forwarded to the connection.
    expect(call.headers?.Authorization).toBe('Bearer secret-key');
  });
});
