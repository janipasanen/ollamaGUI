import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

const { registerSpy, openPanelSpy } = vi.hoisted(() => ({
  registerSpy: vi.fn(),
  openPanelSpy: vi.fn(),
}));

vi.mock('../components/PanelShell', () => ({
  panelRegistry: {
    register: (...args: any[]) => registerSpy(...args),
    unregister: vi.fn(),
    list: vi.fn(() => []),
    get: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
  openPanel: (...args: any[]) => openPanelSpy(...args),
  closePanel: vi.fn(),
  togglePanel: vi.fn(),
  isPanelOpen: vi.fn(),
}));



import FileTreePanel, { _mocks, registerFileTreePanel } from '../components/FileTreePanel';
import { closeWorkspace, openWorkspace } from '../services/workspace';
import { _mocks as fileToolsMocks } from '../services/fileTools';

const sampleEntries = [
  { name: 'src', path: '/ws/src', is_dir: true, size: 0, modified_ms: null },
  { name: 'README.md', path: '/ws/README.md', is_dir: false, size: 12, modified_ms: null },
];

beforeEach(() => {
  localStorage.clear();
  _mocks.listWorkspaceDir = async () => [...sampleEntries];
});

afterEach(() => {
  cleanup();
  closeWorkspace();
  _mocks.listWorkspaceDir = null;
});

describe('FileTreePanel (#85, #81)', () => {
  beforeAll(() => {
    registerFileTreePanel();
  });

  it('registers as a side-dock panel (id "files") at module load', () => {
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0][0]).toMatchObject({
      id: 'files',
      title: 'Files',
      dock: 'side',
    });
  });

  it('shows an empty-state chooser when no workspace is open', () => {
    const registered = registerSpy.mock.calls[0][0];
    render(registered.render(false));
    expect(screen.getByText('No workspace open.')).toBeInTheDocument();
    expect(screen.getByText('Choose folder')).toBeInTheDocument();
  });

  it('lists top-level entries when a workspace is open', async () => {
    fileToolsMocks.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'set_workspace_root') return undefined;
      throw new Error(`Unexpected: ${cmd}`);
    });
    await openWorkspace('/ws');

    const registered = registerSpy.mock.calls[0][0];
    const { rerender } = render(registered.render(false));

    await act(async () => { /* wait for list effect */ });
    rerender(registered.render(false));

    expect(screen.getByTestId('file-tree-list')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('src')).toBeInTheDocument();
  });

  it('expands a directory and fetches its children', async () => {
    fileToolsMocks.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'set_workspace_root') return undefined;
      throw new Error(`Unexpected: ${cmd}`);
    });
    _mocks.listWorkspaceDir = async (path?: string) => {
      if (path === '/ws/src') {
        return [{ name: 'app.ts', path: '/ws/src/app.ts', is_dir: false, size: 0, modified_ms: null }];
      }
      return [...sampleEntries];
    };
    await openWorkspace('/ws');

    const registered = registerSpy.mock.calls[0][0];
    const { rerender } = render(registered.render(false));
    await act(async () => {});
    rerender(registered.render(false));

    const folder = screen.getByText('src');
    fireEvent.click(folder);

    await act(async () => {});
    rerender(registered.render(false));

    expect(screen.getByText('app.ts')).toBeInTheDocument();
  });

  it('dispatches an event when a file is selected', async () => {
    fileToolsMocks.invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'set_workspace_root') return undefined;
      throw new Error(`Unexpected: ${cmd}`);
    });
    await openWorkspace('/ws');
    const handler = vi.fn();
    window.addEventListener('ollama-gui:select-file' as any, handler);

    const registered = registerSpy.mock.calls[0][0];
    const { rerender } = render(registered.render(false));
    await act(async () => {});
    rerender(registered.render(false));

    fireEvent.click(screen.getByText('README.md'));
    window.removeEventListener('ollama-gui:select-file' as any, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail.entry as { path: string };
    expect(detail.path).toBe('/ws/README.md');
  });
});
