import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';
import { storage, type Project } from '../services/storage';
import { _mocks as fileMocks } from '../services/fileTools';
import { _mocks as gitMocks } from '../services/git';
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
    if (String(url).includes('/api/chat')) return chatStreamResponse('# AGENTS.md\n\nTest conventions.');
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
  fileMocks.invoke = async (cmd: string, args: any) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'read_file') return '';
    if (cmd === 'list_dir') return [];
    if (cmd === 'write_file') return undefined;
    return undefined;
  };
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  fileMocks.invoke = null;
  gitMocks.invoke = null;
  _cliMocks.invoke = null;
});

function seedProject(root = '/ws/repo'): Project {
  const proj: Project = { id: 'repo-proj', name: 'Repo', workspaceRoot: root, instructions: '', createdAt: 1 };
  storage.saveProject(proj);
  return proj;
}

// ── #363: File-tree click pins a file into context ────────────────────────────

describe('File-tree click pins a file into context (#363)', () => {
  it('dispatching the select-file event pins the file', async () => {
    seedProject('/ws/repo');
    fileMocks.invoke = async (cmd: string, args: any) => {
      if (cmd === 'set_workspace_root') return undefined;
      if (cmd === 'read_file') {
        if (args.path === '/ws/repo/src/main.ts') return 'export const x = 1;';
        return '';
      }
      if (cmd === 'list_dir') return [];
      return undefined;
    };

    render(<App />);
    // Project rows carry aria-label = project name; clicking sets it active
    // (which syncs the workspace root).
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Repo' })); });

    // Dispatch the same event FileTreePanel would dispatch on file click.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('ollama-gui:select-file', {
        detail: { entry: { path: '/ws/repo/src/main.ts', name: 'main.ts', is_dir: false } },
      }));
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Pinned "src\/main\.ts"/);
    }, { timeout: 3000 });

    // The pinned file chip should appear above the composer.
    expect(screen.getByLabelText('Drop pinned file src/main.ts')).toBeInTheDocument();
  });

  it('ignores directory entries', async () => {
    seedProject('/ws/repo');
    render(<App />);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Repo' })); });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('ollama-gui:select-file', {
        detail: { entry: { path: '/ws/repo/src', name: 'src', is_dir: true } },
      }));
    });

    // No status banner should appear for a directory.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

// #364 (sidebar drag-and-drop into folder chips) was removed with the UI
// rewrite: folder chips, the "+ folder" button, and per-row folder selects no
// longer exist on any surface, so those tests were deleted.

// ── #365: /init generates AGENTS.md ───────────────────────────────────────────

describe('/init generates an AGENTS.md file (#365)', () => {
  it('lists the workspace, streams from the model, and writes AGENTS.md', async () => {
    seedProject('/ws/repo');
    const writeSpy = vi.fn(async (cmd: string, args: any) => {
      if (cmd === 'set_workspace_root') return undefined;
      if (cmd === 'read_file') return '';
      if (cmd === 'list_dir') return [
        { name: 'src', path: '/ws/repo/src', is_dir: true, size: 0, modified_ms: null },
        { name: 'package.json', path: '/ws/repo/package.json', is_dir: false, size: 100, modified_ms: null },
        { name: 'README.md', path: '/ws/repo/README.md', is_dir: false, size: 200, modified_ms: null },
      ];
      if (cmd === 'write_file') return undefined;
      return undefined;
    });
    fileMocks.invoke = writeSpy as any;

    render(<App />);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Repo' })); });

    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/init' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/AGENTS\.md created/);
    }, { timeout: 5000 });

    // Verify write_file was called with the AGENTS.md path.
    const writeCall = writeSpy.mock.calls.find(c => c[0] === 'write_file');
    expect(writeCall).toBeTruthy();
    expect(writeCall![1].path).toBe('/ws/repo/AGENTS.md');
    expect(writeCall![1].content).toContain('AGENTS.md');
  });

  it('refuses with no workspace', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/init' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/No workspace open/));
  });
});
