import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';
import { storage, type ChatSession, type Project, type Folder } from '../services/storage';
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
  fileMocks.invoke = async (cmd: string, _args: any) => {
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
    await act(async () => { fireEvent.click(await screen.findByText('📂 Repo')); });

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
    await act(async () => { fireEvent.click(await screen.findByText('📂 Repo')); });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('ollama-gui:select-file', {
        detail: { entry: { path: '/ws/repo/src', name: 'src', is_dir: true } },
      }));
    });

    // No status banner should appear for a directory.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

// ── #364: Sidebar drag-and-drop to move conversations into folders ────────────

describe('Sidebar drag-and-drop into folders (#364)', () => {
  it('dragging a session onto a folder chip moves it', async () => {
    const folder: Folder = { id: 'f_work', name: 'Work', order: 0 };
    storage.saveFolder(folder);
    const session: ChatSession = {
      id: 's1', title: 'My Chat', createdAt: 1, model: 'llama3', messages: [],
    };
    storage.saveSession(session);

    render(<App />);
    const sessionRow = await screen.findByRole('button', { name: 'Load session: My Chat' });
    const folderChip = screen.getByTitle(/Folder: Work/);

    // Simulate HTML5 drag-and-drop with a mock DataTransfer.
    const dt = { setData: vi.fn(), getData: vi.fn(() => 's1'), effectAllowed: 'move', dropEffect: 'move' };
    fireEvent.dragStart(sessionRow, { dataTransfer: dt });
    fireEvent.dragOver(folderChip, { dataTransfer: dt });
    fireEvent.drop(folderChip, { dataTransfer: dt });

    await waitFor(() => {
      const updated = storage.getSessions().find(s => s.id === session.id);
      expect(updated?.folderId).toBe('f_work');
    });
  });

  it('dragging onto the All chip unfiles the session', async () => {
    const folder: Folder = { id: 'f_work', name: 'Work', order: 0 };
    storage.saveFolder(folder);
    const session: ChatSession = {
      id: 's2', title: 'Filed Chat', createdAt: 2, model: 'llama3', messages: [], folderId: 'f_work',
    };
    storage.saveSession(session);

    render(<App />);
    // Switch to the Work folder so the session is visible
    fireEvent.click(screen.getByTitle(/Folder: Work/));
    const sessionRow = await screen.findByRole('button', { name: 'Load session: Filed Chat' });
    const allChip = screen.getByTitle(/All conversations/);

    const dt2 = { setData: vi.fn(), getData: vi.fn(() => 's2'), effectAllowed: 'move', dropEffect: 'move' };
    fireEvent.dragStart(sessionRow, { dataTransfer: dt2 });
    fireEvent.dragOver(allChip, { dataTransfer: dt2 });
    fireEvent.drop(allChip, { dataTransfer: dt2 });

    await waitFor(() => {
      const updated = storage.getSessions().find(s => s.id === session.id);
      expect(updated?.folderId).toBeUndefined();
    });
  });
});

// ── #365: /init generates AGENTS.md ───────────────────────────────────────────

describe('/init generates an AGENTS.md file (#365)', () => {
  it('lists the workspace, streams from the model, and writes AGENTS.md', async () => {
    seedProject('/ws/repo');
    const writeSpy = vi.fn(async (cmd: string, _args: any) => {
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
    await act(async () => { fireEvent.click(await screen.findByText('📂 Repo')); });

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

  it('routes the AGENTS.md generation to an OpenAI connection /v1/chat/completions with the bare model name (#569)', async () => {
    // An OpenAI-compatible (LM Studio / vLLM) connection. The generation must
    // NOT POST to local Ollama, and must use the bare model name.
    localStorage.setItem('model_connections', JSON.stringify([
      { id: 'conn-openai', name: 'LM Studio', kind: 'openai', baseUrl: 'http://lm:1234', apiKey: 'secret-key', enabled: true },
    ]));
    seedProject('/ws/repo');

    const chatCalls: { url: string; body: any }[] = [];
    let localChatCalled = false;

    function openAiStream(content: string) {
      const reader = { read: vi.fn() as ReturnType<typeof vi.fn> };
      reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from(`data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}\n`) });
      reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('data: {"choices":[{"delta":{}}]}\n') });
      reader.read.mockResolvedValueOnce({ done: true, value: undefined });
      return Promise.resolve({ ok: true, body: { getReader: () => reader } });
    }

    fileMocks.invoke = async (cmd: string) => {
      if (cmd === 'set_workspace_root') return undefined;
      if (cmd === 'read_file') return '';
      if (cmd === 'list_dir') return [{ name: 'src', path: '/ws/repo/src', is_dir: true, size: 0, modified_ms: null }];
      if (cmd === 'write_file') return undefined;
      return undefined;
    };

    global.fetch = vi.fn(async (url: unknown, opts: any) => {
      const u = String(url);
      if (u.includes('/v1/models')) return { ok: true, json: async () => ({ data: [{ id: 'qwen' }] }) } as any;
      if (u.includes('/v1/chat/completions')) {
        chatCalls.push({ url: u, body: JSON.parse(opts.body) });
        return openAiStream('# AGENTS.md\n\nTest conventions.');
      }
      if (u.includes('/api/chat')) { localChatCalled = true; return chatStreamResponse('# AGENTS.md\n\nTest conventions.'); }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    await act(async () => { fireEvent.click(await screen.findByText('📂 Repo')); });

    const sel = screen.getByLabelText('Select AI model') as HTMLSelectElement;
    await waitFor(() =>
      expect(screen.getAllByRole('option').map(o => o.getAttribute('value'))).toContain('conn-openai/qwen'),
      { timeout: 5000 },
    );
    fireEvent.change(sel, { target: { value: 'conn-openai/qwen' } });
    await waitFor(() => expect(sel.value).toBe('conn-openai/qwen'), { timeout: 5000 });

    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/init' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/AGENTS\.md created/), { timeout: 5000 });

    // The generation went to the connection's /v1/chat/completions, not local /api/chat.
    expect(localChatCalled).toBe(false);
    expect(chatCalls.length).toBeGreaterThan(0);
    const call = chatCalls[chatCalls.length - 1];
    expect(call.url).toContain('http://lm:1234/v1/chat/completions');
    // Bare model name, not the connection-scoped selector id.
    expect(call.body.model).toBe('qwen');
    expect(call.body.model).not.toBe('conn-openai/qwen');
  });

  it('refuses with no workspace', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/init' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/No workspace open/));
  });
});
