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
