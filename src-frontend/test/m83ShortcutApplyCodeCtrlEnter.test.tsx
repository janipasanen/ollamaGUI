import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { storage, type ChatSession, type Project } from '../services/storage';
import { _mocks as fileMocks } from '../services/fileTools';
import { isPanelOpen } from '../components/PanelShell';

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
    if (String(url).includes('/api/chat')) return chatStreamResponse('done');
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
  fileMocks.invoke = async (cmd: string) => {
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
});

// ── #372: Artifacts shortcut + help overlay ───────────────────────────────────

describe('Artifacts panel keyboard shortcut + help overlay (#372)', () => {
  it('Ctrl+Shift+A toggles the artifacts panel', () => {
    render(<App />);
    expect(isPanelOpen('artifacts')).toBe(false);
    fireEvent.keyDown(window, { key: 'A', shiftKey: true, ctrlKey: true });
    expect(isPanelOpen('artifacts')).toBe(true);
    fireEvent.keyDown(window, { key: 'A', shiftKey: true, ctrlKey: true });
    expect(isPanelOpen('artifacts')).toBe(false);
  });

  it('help overlay lists Toggle Artifacts and Tab Indent', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByText('Toggle Artifacts')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Shift+A')).toBeInTheDocument();
    expect(screen.getByText('Tab Indent / Outdent')).toBeInTheDocument();
    expect(screen.getByText('Tab / Shift+Tab')).toBeInTheDocument();
  });
});

// ── #373: Apply code block to file ────────────────────────────────────────────

describe('Apply code block to file (#373)', () => {
  it('shows an Apply button on code blocks and writes to file on click', async () => {
    const proj: Project = { id: 'repo-proj', name: 'Repo', workspaceRoot: '/ws/repo', instructions: '', createdAt: 1 };
    storage.saveProject(proj);

    const writeSpy = vi.fn(async (cmd: string, args: any) => {
      if (cmd === 'set_workspace_root') return undefined;
      if (cmd === 'read_file') return '';
      if (cmd === 'list_dir') return [];
      if (cmd === 'write_file') return undefined;
      return undefined;
    });
    fileMocks.invoke = writeSpy as any;

    // Seed a session associated with the project, containing a code block
    const session: ChatSession = {
      id: 's1', title: 'Code', createdAt: 1, model: 'llama3', projectId: 'repo-proj',
      messages: [
        { role: 'user', content: 'write a function' },
        { role: 'assistant', content: 'Here is the code:\n\n```ts:src/helper.ts\nexport const add = (a: number, b: number) => a + b;\n```' },
      ],
    };
    storage.saveSession(session);

    render(<App />);
    // Activate the project first so the workspace root is set
    fireEvent.click(await screen.findByText('📂 Repo'));
    // Wait for the workspace to be set and sessions to filter
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load session: Code' })).toBeInTheDocument();
    }, { timeout: 3000 });
    // Load the session
    fireEvent.click(screen.getByRole('button', { name: 'Load session: Code' }));

    // Wait for code block to render with the Apply button
    const applyBtn = await screen.findByLabelText('Apply code to file', {}, { timeout: 5000 });
    expect(applyBtn).toBeInTheDocument();

    fireEvent.click(applyBtn);

    await waitFor(() => {
      const writeCall = writeSpy.mock.calls.find(c => c[0] === 'write_file');
      expect(writeCall).toBeTruthy();
      expect(writeCall![1].path).toBe('/ws/repo/src/helper.ts');
      expect(writeCall![1].content).toContain('export const add');
    }, { timeout: 3000 });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Applied to/);
    });
  });

  it('does not show Apply button when no workspace is open', async () => {
    const session: ChatSession = {
      id: 's2', title: 'Code2', createdAt: 2, model: 'llama3',
      messages: [
        { role: 'user', content: 'write code' },
        { role: 'assistant', content: '```ts\nconst x = 1;\n```' },
      ],
    };
    storage.saveSession(session);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load session: Code2' }));

    // The Apply button should not appear without a workspace
    await waitFor(() => {
      expect(screen.queryByLabelText('Apply code to file')).not.toBeInTheDocument();
    });
  });
});

// ── #374: Ctrl+Enter to send option ───────────────────────────────────────────

describe('Send on Ctrl+Enter option (#374)', () => {
  it('Enter sends by default (no Ctrl needed)', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'hello' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    // The message should be sent — check that the composer is cleared or a user message appears
    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument();
    });
  });

  it('Enter inserts a newline when sendOnCtrlEnter is enabled', async () => {
    localStorage.setItem('ollama_gui_send_on_ctrl_enter', 'true');
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'hello' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    // Message should NOT be sent — no user message with 'hello' should appear
    // The composer should still have the text
    expect(composer.value).toBe('hello');
    // No user message bubble with 'hello'
    const msgs = screen.queryAllByText('hello', { selector: 'p' });
    expect(msgs.length).toBe(0);
  });

  it('Ctrl+Enter sends when sendOnCtrlEnter is enabled', async () => {
    localStorage.setItem('ollama_gui_send_on_ctrl_enter', 'true');
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'test message' } });
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText('test message')).toBeInTheDocument();
    });
  });

  it('settings overlay has a Send on Ctrl+Enter toggle', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    expect(screen.getByText(/Send on Ctrl\+Enter/)).toBeInTheDocument();
    expect(screen.getByLabelText('Toggle send on Ctrl+Enter')).toBeInTheDocument();
  });
});
