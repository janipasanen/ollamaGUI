import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { storage, type Project } from '../services/storage';
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
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  fileMocks.invoke = null;
});

function sendCommand(cmd: string) {
  const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
  fireEvent.change(composer, { target: { value: cmd } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

// ── /reset params to defaults (#348) ──────────────────────────────────────────

describe('/reset restores generation parameters (#348)', () => {
  it('clears temperature/top-p/etc back to defaults', async () => {
    render(<App />);

    sendCommand('/temp 0.9');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Temperature set to 0\.9/));

    sendCommand('/topp 0.5');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Top-p set to 0\.5/));

    sendCommand('/reset');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Reset generation parameters to defaults/));

    sendCommand('/params');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Temperature: default/));
    expect(screen.getByRole('status').textContent).toMatch(/Top-p: default/);
  });
});

// ── /tokens per-source breakdown (#349) ───────────────────────────────────────

describe('/tokens shows a per-source context breakdown (#349)', () => {
  it('lists each context source and a total', async () => {
    render(<App />);

    sendCommand('/tokens');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Context tokens \(est\./));
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toMatch(/rules/);
    expect(text).toMatch(/instructions/);
    expect(text).toMatch(/memory/);
    expect(text).toMatch(/system/);
    expect(text).toMatch(/conversation/);
    expect(text).toMatch(/total/);
  });
});

// ── /add & /drop pinned file context (#350) ───────────────────────────────────

describe('/add & /drop pinned file context (#350)', () => {
  it('pins a file, shows a chip, then drops it', async () => {
    const proj: Project = {
      id: 'repo-proj', name: 'Repo', workspaceRoot: '/ws/repo',
      instructions: '', createdAt: 1,
    };
    storage.saveProject(proj);

    fileMocks.invoke = async (cmd: string, args: any) => {
      if (cmd === 'set_workspace_root') return undefined;
      if (cmd === 'read_file') {
        const path: string = args?.path ?? '';
        if (path.includes('foo.txt')) return 'FILE CONTENTS';
        return '';
      }
      return undefined;
    };

    render(<App />);

    // Activate the project so /add has a workspace root. In the project-first
    // sidebar, clicking the project row (aria-label = name) sets it active.
    fireEvent.click(await screen.findByRole('button', { name: 'Repo' }));

    sendCommand('/add foo.txt');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Pinned "foo\.txt"/), { timeout: 3000 });
    expect(screen.getByText(/📎 foo\.txt/)).toBeInTheDocument();

    sendCommand('/drop foo.txt');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Dropped "foo\.txt"/), { timeout: 3000 });
    await waitFor(() => expect(screen.queryByText(/📎 foo\.txt/)).not.toBeInTheDocument());
  });

  it('refuses /add with no workspace', async () => {
    render(<App />);
    sendCommand('/add foo.txt');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/No workspace open/));
  });

  it('refuses /drop when the file is not pinned', async () => {
    render(<App />);
    sendCommand('/drop foo.txt');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/is not pinned/));
  });

  it('/files reports when nothing is pinned', async () => {
    render(<App />);
    sendCommand('/files');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/No pinned files/));
  });
});
