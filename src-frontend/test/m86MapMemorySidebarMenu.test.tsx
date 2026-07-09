import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';
import { storage, type ChatSession } from '../services/storage';
import { _mocks as fileMocks } from '../services/fileTools';
import { _mocks as fileTreeMocks } from '../components/FileTreePanel';
import { openWorkspace, closeWorkspace } from '../services/workspace';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/api/chat')) {
      return {
        ok: true,
        body: { getReader: () => ({ read: vi.fn().mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"ok"}}\n') }).mockResolvedValueOnce({ done: true, value: undefined }) }) },
      } as any;
    }
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
  fileMocks.invoke = async (cmd: string, args: any) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'read_file') return '';
    if (cmd === 'list_dir') {
      const path = args?.path;
      if (path && path.endsWith('/src')) return [{ name: 'app.ts', path: path + '/app.ts', is_dir: false, size: 1, modified_ms: null }];
      return [
        { name: 'README.md', path: '/ws/repo/README.md', is_dir: false, size: 1, modified_ms: null },
        { name: 'src', path: '/ws/repo/src', is_dir: true, size: 0, modified_ms: null },
      ];
    }
    return undefined;
  };
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  fileMocks.invoke = null;
  fileTreeMocks.listWorkspaceDir = null;
  closeWorkspace();
});

function sendCommand(cmd: string) {
  const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
  fireEvent.change(composer, { target: { value: cmd } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

// ── #383: /memory slash command ───────────────────────────────────────────────

describe('/memory slash command (#383)', () => {
  it('shows the composed memory block with the entry count', async () => {
    localStorage.setItem('ollama_gui_memory', JSON.stringify([
      { id: 'm1', text: 'User prefers concise answers', scope: 'global', createdAt: 1 },
    ]));
    render(<App />);
    sendCommand('/memory');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Memory \(1 entry\):.*prefers concise answers/);
    });
  });

  it('reports no memory entries when empty', async () => {
    render(<App />);
    sendCommand('/memory');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/No memory entries/);
    });
  });
});

// ── #382: /map slash command ──────────────────────────────────────────────────

describe('/map slash command (#382)', () => {
  it('emits a repo-map overview into the chat', async () => {
    await openWorkspace('/ws/repo');
    const session: ChatSession = { id: 's-map', title: 'Map Chat', createdAt: 1, model: 'llama3', messages: [] };
    storage.saveSession(session);

    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Map Chat/i })[0]);
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument());

    sendCommand('/map');
    // /map reads the workspace and reports the top-level entry count.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Repo map: 2 top-level entries/);
    });
  });

  it('reports no workspace when none is open', async () => {
    render(<App />);
    sendCommand('/map');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/No workspace open/);
    });
  });
});

// ── #381: Right-click context menu on sidebar session items ───────────────────

describe('Sidebar session right-click context menu (#381)', () => {
  it('opens a context menu with session actions on right-click', async () => {
    storage.saveSession({ id: 's-ctx', title: 'Sidebar Ctx', createdAt: 1, model: 'llama3', messages: [] });
    render(<App />);
    const row = await screen.findByRole('button', { name: /Load session: Sidebar Ctx/i });

    fireEvent.contextMenu(row, { clientX: 40, clientY: 40 });
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Pin' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('Delete item opens the delete-confirmation dialog', async () => {
    storage.saveSession({ id: 's-del', title: 'Del Ctx', createdAt: 2, model: 'llama3', messages: [] });
    render(<App />);
    const row = await screen.findByRole('button', { name: /Load session: Del Ctx/i });

    fireEvent.contextMenu(row, { clientX: 40, clientY: 40 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Delete chat confirmation' })).toBeInTheDocument();
    });
  });

  it('closes the context menu on Escape', async () => {
    storage.saveSession({ id: 's-esc', title: 'Esc Ctx', createdAt: 3, model: 'llama3', messages: [] });
    render(<App />);
    const row = await screen.findByRole('button', { name: /Load session: Esc Ctx/i });

    fireEvent.contextMenu(row, { clientX: 40, clientY: 40 });
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument());
  });
});
