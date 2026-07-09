import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';
import { storage, type ChatSession } from '../services/storage';
import { _mocks as fileMocks } from '../services/fileTools';
import { _mocks as fileTreeMocks } from '../components/FileTreePanel';
import { openWorkspace, closeWorkspace, getActiveRoot } from '../services/workspace';

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
    if (String(url).includes('/api/chat')) return chatStreamResponse('Sure thing');
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
  fileMocks.invoke = async (cmd: string) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'read_file') return '';
    if (cmd === 'list_dir') return [];
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

// ── #379: /cwd slash command ──────────────────────────────────────────────────

describe('/cwd slash command (#379)', () => {
  it('shows and copies the active workspace root path', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true });

    await openWorkspace('/ws/my-repo');
    expect(getActiveRoot()).toBe('/ws/my-repo');

    render(<App />);
    sendCommand('/cwd');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Workspace: \/ws\/my-repo/);
    });
    expect(writeText).toHaveBeenCalledWith('/ws/my-repo');
  });

  it('reports no workspace when none is open', async () => {
    render(<App />);
    sendCommand('/cwd');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/No workspace open/);
    });
  });
});

// ── #380: FileTreePanel reflects workspace changes via custom event ───────────

describe('FileTreePanel workspace sync (#380)', () => {
  it('refreshes the tree when the workspace-changed event fires', async () => {
    fileTreeMocks.listWorkspaceDir = async (path?: string) => {
      if (path === '/ws/alpha') return [{ name: 'alpha.txt', path: '/ws/alpha/alpha.txt', is_dir: false, size: 1, modified_ms: null }];
      if (path === '/ws/beta') return [{ name: 'beta.txt', path: '/ws/beta/beta.txt', is_dir: false, size: 1, modified_ms: null }];
      return [];
    };

    await openWorkspace('/ws/alpha');

    render(<App />);
    const filesBtn = await screen.findByRole('button', { name: /files panel/i });
    fireEvent.click(filesBtn);

    await waitFor(() => expect(screen.getByText('alpha.txt')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.queryByText('beta.txt')).not.toBeInTheDocument();

    // Switch workspace via openWorkspace — this updates localStorage AND the
    // fileTools root, then dispatches the ollama-gui:workspace-changed event.
    await act(async () => { await openWorkspace('/ws/beta'); });

    await waitFor(() => expect(screen.getByText('beta.txt')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.queryByText('alpha.txt')).not.toBeInTheDocument();
  });
});

// ── #378: Right-click context menu on chat messages ───────────────────────────

describe('Right-click context menu on messages (#378)', () => {
  it('opens a context menu on right-click of an assistant message', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true });

    const session: ChatSession = {
      id: 's1', title: 'Ctx Chat', createdAt: 1, model: 'llama3',
      messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Reply text here' }],
    };
    storage.saveSession(session);

    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Load session: Ctx Chat/i }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Ctx Chat/i })[0]);
    await waitFor(() => expect(screen.getByText('Reply text here')).toBeInTheDocument(), { timeout: 3000 });

    // Right-click the assistant message content — the contextmenu event bubbles
    // up to the group/msg bubble that carries the onContextMenu handler.
    fireEvent.contextMenu(screen.getByText('Reply text here'), { clientX: 100, clientY: 100 });

    const menu = await screen.findByTestId('message-context-menu');
    expect(menu).toHaveAttribute('role', 'menu');
    expect(screen.getByRole('menuitem', { name: 'Copy message' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy message' }));
    expect(writeText).toHaveBeenCalledWith('Reply text here');
  });

  it('closes the context menu on Escape', async () => {
    storage.saveSession({
      id: 's2', title: 'Esc Chat', createdAt: 2, model: 'llama3',
      messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Escape me' }],
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Load session: Esc Chat/i }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Esc Chat/i })[0]);
    await waitFor(() => expect(screen.getByText('Escape me')).toBeInTheDocument(), { timeout: 3000 });

    fireEvent.contextMenu(screen.getByText('Escape me'), { clientX: 50, clientY: 50 });
    expect(await screen.findByTestId('message-context-menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('message-context-menu')).not.toBeInTheDocument());
  });

  it('offers user-message actions (Edit, Delete, Quote) on user messages', async () => {
    storage.saveSession({
      id: 's3', title: 'User Ctx', createdAt: 3, model: 'llama3',
      messages: [{ role: 'user', content: 'My question' }, { role: 'assistant', content: 'Answer' }],
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Load session: User Ctx/i }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: User Ctx/i })[0]);
    await waitFor(() => expect(screen.getByText('My question')).toBeInTheDocument(), { timeout: 3000 });

    fireEvent.contextMenu(screen.getByText('My question'), { clientX: 10, clientY: 10 });
    expect(await screen.findByRole('menuitem', { name: 'Edit message' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Quote into composer' })).toBeInTheDocument();
  });
});
