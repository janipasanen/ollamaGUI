import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { storage } from '../services/storage';
import { _mocks as fileMocks } from '../services/fileTools';
import FileTreePanel, { _mocks as fileTreeMocks } from '../components/FileTreePanel';

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
  fileMocks.invoke = async (cmd: string, _args: any) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'read_file') return 'export const x = 1;';
    if (cmd === 'write_file') return undefined;
    if (cmd === 'list_dir') return [];
    return undefined;
  };
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  fileMocks.invoke = null;
  fileTreeMocks.listWorkspaceDir = null;
});

function sendCommand(cmd: string) {
  const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
  fireEvent.change(composer, { target: { value: cmd } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

// #387 (Rename folder via the sidebar ✏️ button) is gone: the new project-first
// sidebar removed folder chips and the rename-folder button entirely, with no
// replacement surface, so those tests were deleted.

// ── #388: Drag a file from the file tree into the composer to pin it ──────────
// The dock is gone from the new UI (App never mounts panels), but the composer
// dropzone still accepts text/file-path drops and FileTreePanel still sets that
// payload on dragStart — mount App and the panel side by side.

describe('Drag file from tree into composer (#388)', () => {
  it('pins a file dragged from the file tree onto the composer', async () => {
    localStorage.setItem('ollama_gui_workspace', JSON.stringify({ root: '/ws/repo', recentRoots: ['/ws/repo'] }));
    fileTreeMocks.listWorkspaceDir = async () => [
      { name: 'main.ts', path: '/ws/repo/src/main.ts', is_dir: false, size: 1, modified_ms: null },
    ];

    render(<App />);
    render(<FileTreePanel dark={false} />);
    await waitFor(() => expect(screen.getByText('main.ts')).toBeInTheDocument(), { timeout: 8000 });

    // Shared dataTransfer mock: dragStart stores, drop reads.
    const store: Record<string, string> = {};
    const dt = {
      setData: (k: string, v: string) => { store[k] = v; },
      getData: (k: string) => store[k] ?? '',
      effectAllowed: '',
      dropEffect: '',
    } as any;

    fireEvent.dragStart(screen.getByText('main.ts'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('composer-dropzone'), { dataTransfer: dt });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Pinned "main\.ts"/);
    }, { timeout: 8000 });
  }, 20000);
});

// ── #389: /redo slash command ─────────────────────────────────────────────────

describe('/redo slash command (#389)', () => {
  it('restores an undone exchange', async () => {
    storage.saveSession({
      id: 's-redo', title: 'Redo Chat', createdAt: 1, model: 'llama3',
      messages: [{ role: 'user', content: 'what is 2+2' }, { role: 'assistant', content: 'it is four' }],
    });

    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Redo Chat/i })[0]);
    await waitFor(() => expect(screen.getByText('it is four')).toBeInTheDocument(), { timeout: 3000 });

    // /undo drops the exchange.
    sendCommand('/undo');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Undid last exchange \(2 messages\)/));
    await waitFor(() => expect(screen.queryByText('it is four')).not.toBeInTheDocument());

    // /redo restores it.
    sendCommand('/redo');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Redid last exchange \(2 messages\)/));
    await waitFor(() => expect(screen.getByText('it is four')).toBeInTheDocument());

    // Nothing left to redo.
    sendCommand('/redo');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Nothing to redo/));
  }, 20000);
});
