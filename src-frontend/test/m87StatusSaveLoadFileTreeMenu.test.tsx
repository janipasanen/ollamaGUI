import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { storage, type ChatSession } from '../services/storage';
import { _mocks as fileMocks } from '../services/fileTools';
import FileTreePanel, { _mocks as fileTreeMocks } from '../components/FileTreePanel';
import { openWorkspace, closeWorkspace } from '../services/workspace';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  fileMocks.invoke = async (cmd: string, _args: any) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'read_file') return '';
    if (cmd === 'write_file') return undefined;
    if (cmd === 'list_dir') return [];
    return undefined;
  };
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/api/chat')) {
      return {
        ok: true,
        body: { getReader: () => ({ read: vi.fn().mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"ok"}}\n') }).mockResolvedValueOnce({ done: true, value: undefined }) }) },
      } as any;
    }
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
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

function loadSession(title: string) {
  fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`Load session: ${title}`) })[0]);
}

// ── #385: /status slash command ───────────────────────────────────────────────

describe('/status slash command (#385)', () => {
  it('shows a combined overview banner', async () => {
    await openWorkspace('/ws/repo');
    storage.saveSession({
      id: 's-status', title: 'Status Chat', createdAt: 1, model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    });

    render(<App />);
    loadSession('Status Chat');
    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument(), { timeout: 3000 });

    sendCommand('/status');
    await waitFor(() => {
      const banner = screen.getByRole('status');
      expect(banner).toHaveTextContent(/Model: /);
      expect(banner).toHaveTextContent(/Workspace: \/ws\/repo/);
      expect(banner).toHaveTextContent(/Messages: 2/);
    });
  });
});

// ── #386: /save & /load conversation snapshots ────────────────────────────────

describe('/save and /load conversation snapshots (#386)', () => {
  it('/save writes the conversation JSON into the workspace', async () => {
    await openWorkspace('/ws/repo');
    storage.saveSession({
      id: 's-save', title: 'Save Chat', createdAt: 1, model: 'llama3',
      messages: [{ role: 'user', content: 'remember this' }, { role: 'assistant', content: 'saved reply' }],
    });
    const written: Record<string, string> = {};
    fileMocks.invoke = async (cmd: string, args: any) => {
      if (cmd === 'set_workspace_root') return undefined;
      if (cmd === 'write_file') { written[args.path] = args.content; return undefined; }
      if (cmd === 'read_file') return written[args.path] ?? '';
      if (cmd === 'list_dir') return [];
      return undefined;
    };

    render(<App />);
    loadSession('Save Chat');
    await waitFor(() => expect(screen.getByText('saved reply')).toBeInTheDocument(), { timeout: 3000 });

    sendCommand('/save my-chat');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Saved conversation to \.ollama-gui\/sessions\/my-chat\.json/);
    });
    const savedPath = Object.keys(written).find((k) => k.includes('.ollama-gui/sessions/my-chat.json'));
    expect(savedPath).toBeDefined();
    expect(written[savedPath!]).toContain('remember this');
  });

  it('/load reads the snapshot back and loads the session', async () => {
    await openWorkspace('/ws/repo');
    const snap: ChatSession = {
      id: 'snap-1', title: 'Snap Chat', createdAt: 2, model: 'llama3',
      messages: [{ role: 'user', content: 'snap question' }, { role: 'assistant', content: 'snap answer' }],
    };
    fileMocks.invoke = async (cmd: string, args: any) => {
      if (cmd === 'set_workspace_root') return undefined;
      if (cmd === 'read_file' && String(args.path).includes('.ollama-gui/sessions/my-chat.json')) {
        return JSON.stringify([snap]);
      }
      if (cmd === 'write_file') return undefined;
      if (cmd === 'list_dir') return [];
      return undefined;
    };

    render(<App />);
    sendCommand('/load my-chat');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Loaded conversation "my-chat"/);
    }, { timeout: 4000 });
    await waitFor(() => expect(screen.getByText('snap answer')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('reports no workspace when none is open', async () => {
    render(<App />);
    sendCommand('/save foo');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/No workspace open/));
    sendCommand('/load foo');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/No workspace open/));
  });
});

// ── #384: File-tree right-click context menu ──────────────────────────────────
// The dock is gone from the new UI (App never mounts panels), but the file-tree
// context menu lives in FileTreePanel and "Pin to chat" still reaches App via
// the ollama-gui:select-file event — mount App and the panel side by side.

describe('File-tree right-click context menu (#384)', () => {
  it('offers Pin to chat, Copy path and Copy relative path; Pin to chat pins the file', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true });

    await openWorkspace('/ws/repo');
    localStorage.setItem('ollama_gui_workspace', JSON.stringify({ root: '/ws/repo', recentRoots: ['/ws/repo'] }));
    fileTreeMocks.listWorkspaceDir = async () => [
      { name: 'main.ts', path: '/ws/repo/src/main.ts', is_dir: false, size: 1, modified_ms: null },
    ];
    fileMocks.invoke = async (cmd: string) => {
      if (cmd === 'set_workspace_root') return undefined;
      if (cmd === 'read_file') return 'export const x = 1;';
      if (cmd === 'list_dir') return [];
      return undefined;
    };

    render(<App />);
    render(<FileTreePanel dark={false} />);
    await waitFor(() => expect(screen.getByText('main.ts')).toBeInTheDocument(), { timeout: 8000 });

    // Right-click the file node -> context menu with the three file actions.
    fireEvent.contextMenu(screen.getByText('main.ts'), { clientX: 30, clientY: 30 });
    expect(await screen.findByRole('menuitem', { name: 'Pin to chat' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy path' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy relative path' })).toBeInTheDocument();

    // Copy relative path writes the workspace-relative path to the clipboard.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy relative path' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('src/main.ts'));

    // Re-open the menu and choose Pin to chat -> the file is pinned into context.
    fireEvent.contextMenu(screen.getByText('main.ts'), { clientX: 30, clientY: 30 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin to chat' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Pinned "main\.ts"/);
    }, { timeout: 8000 });
  }, 20000);
});
