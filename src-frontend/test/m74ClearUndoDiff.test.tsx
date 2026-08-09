import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { storage, type Project } from '../services/storage';
import { _mocks as gitMocks } from '../services/git';
import { _mocks as fileMocks } from '../services/fileTools';

let origFetch: typeof global.fetch;

/** Build a mocked fetch Response that streams one JSON chat chunk then ends. */
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

const REPO_DIFF = '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-old\n+new';

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));

  // fileTools seam: satisfy set_workspace_root + read_file (project rules) without Tauri.
  fileMocks.invoke = async (cmd: string) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'read_file') return '';
    return undefined;
  };
  // git seam: return a working-tree diff for git_diff.
  gitMocks.invoke = async (cmd: string) => {
    if (cmd === 'git_diff') return { diff: REPO_DIFF };
    return { success: true };
  };
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  fileMocks.invoke = null;
  gitMocks.invoke = null;
});

async function sendUserMessage(composer: HTMLTextAreaElement, text: string, reply: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/api/chat')) return chatStreamResponse(reply);
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
  fireEvent.change(composer, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => screen.getByText(reply), { timeout: 3000 });
}

// ── /clear clears in-place (#345) ─────────────────────────────────────────────

describe('/clear clears messages in-place (#345)', () => {
  it('clears messages but keeps the session entry (vs /new which drops it)', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;

    await sendUserMessage(composer, 'Hi', 'A reply');
    expect(screen.getByText('A reply')).toBeInTheDocument();

    // A session titled "Hi" should now appear in the sidebar.
    await waitFor(() => {
      const rows = screen.getAllByRole('button', { name: 'Load session: Hi' });
      expect(rows.length).toBeGreaterThan(0);
    });
    const beforeCount = screen.getAllByRole('button', { name: 'Load session: Hi' }).length;

    fireEvent.change(composer, { target: { value: '/clear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // Messages are cleared in-place…
    await waitFor(() => expect(screen.queryByText('A reply')).not.toBeInTheDocument());
    // …but the session entry remains in the sidebar (count unchanged).
    expect(screen.getAllByRole('button', { name: 'Load session: Hi' }).length).toBe(beforeCount);
    expect(composer.value).toBe('');
  });
});

// ── /undo drops the last exchange (#346) ──────────────────────────────────────

describe('/undo drops the last exchange (#346)', () => {
  it('removes only the last user+assistant turn', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;

    await sendUserMessage(composer, 'First', 'R1');
    await sendUserMessage(composer, 'Second', 'R2');

    expect(screen.getAllByText('R1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('R2').length).toBeGreaterThanOrEqual(1);

    fireEvent.change(composer, { target: { value: '/undo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(screen.queryByText('R2')).not.toBeInTheDocument());
    // The first exchange remains.
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(composer.value).toBe('');
  });

  it('refuses when there is nothing to undo', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/undo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Nothing to undo/));
  });
});

// ── /diff feeds git diff into chat (#347) ─────────────────────────────────────

describe('/diff feeds the git diff into chat (#347)', () => {
  it('injects the working-tree diff as a user message', async () => {
    const proj: Project = {
      id: 'repo-proj', name: 'Repo', workspaceRoot: '/ws/repo',
      instructions: '', createdAt: 1,
    };
    storage.saveProject(proj);

    render(<App />);

    // Activate the project so /diff has a workspace root. In the project-first
    // sidebar, clicking the project row (aria-label = name) sets it active.
    fireEvent.click(await screen.findByRole('button', { name: 'Repo' }));

    // A bound project folder derives agentic mode, which changes the composer
    // placeholder — query by the mode-independent aria-label instead.
    const composer = screen.getByLabelText('Type your message here') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/diff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(
      () => expect(screen.getByRole('status')).toHaveTextContent(/Injected working-tree diff/),
      { timeout: 3000 },
    );
    expect(screen.getByText(/Unstaged uncommitted changes for review/i)).toBeInTheDocument();
  });

  it('refuses when no workspace is open', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/diff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/No workspace open/));
  });
});
