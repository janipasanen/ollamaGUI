import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import FileTreePanel, { _mocks as fileTreeMocks } from '../components/FileTreePanel';
import { _mocks as fileMocks } from '../services/fileTools';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ models: [] }), body: null, text: async () => '',
  } as any);
  fileMocks.invoke = async (cmd: string) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'read_file') return '';
    if (cmd === 'list_dir') return [
      { name: 'README.md', path: '/ws/repo/README.md', is_dir: false, size: 100, modified_ms: null },
    ];
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

// ── #375: /settings slash command ─────────────────────────────────────────────

describe('/settings slash command (#375)', () => {
  it('opens the settings overlay', async () => {
    render(<App />);
    expect(screen.queryByRole('heading', { name: /^Settings$/i })).not.toBeInTheDocument();
    sendCommand('/settings');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument();
    });
  });
});

// ── #376: /prompt composed system prompt preview ──────────────────────────────

describe('/prompt composed system prompt preview (#376)', () => {
  it('shows the composed system prompt in an overlay', async () => {
    render(<App />);
    // Set a system prompt first
    sendCommand('/system You are a helpful coding assistant');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/System prompt updated/));

    // Now preview the composed prompt
    sendCommand('/prompt');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Composed System Prompt/i })).toBeInTheDocument();
    });
    // The overlay should contain the system prompt text somewhere in the dialog
    const dialog = screen.getByText(/helpful coding assistant/);
    expect(dialog).toBeInTheDocument();
  });

  it('can be closed with Escape', async () => {
    render(<App />);
    sendCommand('/prompt');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Composed System Prompt/i })).toBeInTheDocument();
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Composed System Prompt/i })).not.toBeInTheDocument();
    });
  });

  it('has a Copy button that copies the composed prompt to clipboard', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true });

    render(<App />);
    sendCommand('/system Test prompt 123');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/System prompt updated/));

    sendCommand('/prompt');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Composed System Prompt/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Copy'));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('Test prompt 123');
  });
});

// ── #377: Copy-path action in file tree ────────────────────────────────────────
// The App no longer mounts any side-dock panels (the files-panel header button
// is gone), but the copy-path action still lives in the FileTreePanel
// component itself — so this is now a component-level test.

describe('Copy-path action in file tree (#377)', () => {
  it('copies a file path to the clipboard when the copy button is clicked', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true });

    // Set workspace state in localStorage so FileTreePanel picks it up
    localStorage.setItem('ollama_gui_workspace', JSON.stringify({ root: '/ws/repo', recentRoots: ['/ws/repo'] }));
    fileTreeMocks.listWorkspaceDir = async () => [
      { name: 'README.md', path: '/ws/repo/README.md', is_dir: false, size: 100, modified_ms: null },
    ];

    render(<FileTreePanel dark={false} />);

    // Wait for the file tree to render
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument();
    }, { timeout: 5000 });

    const copyBtn = screen.getByLabelText('Copy path: README.md');
    fireEvent.click(copyBtn);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toBe('/ws/repo/README.md');
  });
});
