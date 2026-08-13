/**
 * Per-session working directory (#550): each session remembers where its
 * agent works; switching sessions switches the workspace; the folder chip
 * changes it; an unreachable path warns — and never crashes the app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const workspaceMocks = vi.hoisted(() => ({
  openWorkspaceRoots: vi.fn(async (_roots: string[]) => {}),
}));
vi.mock('../services/workspace', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, openWorkspaceRoots: workspaceMocks.openWorkspaceRoots };
});

const platformMocks = vi.hoisted(() => ({
  pickDirectory: vi.fn(async () => '/tmp/other-repo'),
  // null = "cannot check" (outside Tauri) — the pre-#550 behavior, so the
  // existing tests keep exercising the openWorkspaceRoots-rejection path.
  checkPath: vi.fn(async (_path: string): Promise<{ exists: boolean; isDir: boolean; readable: boolean } | null> => null),
}));
vi.mock('../services/platform', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, pickDirectory: platformMocks.pickDirectory, checkPath: platformMocks.checkPath, probeBinary: vi.fn(async () => false) };
});

import App from '../App';
import { storage } from '../services/storage';

const PROJECT = {
  id: 'proj_w', name: 'workdir-proj', workspaceRoot: '/repos/main',
  workspaceRoots: ['/repos/main'], instructions: '', createdAt: 1_700_000_000_000,
};

beforeEach(() => {
  localStorage.clear();
  workspaceMocks.openWorkspaceRoots.mockReset().mockResolvedValue(undefined);
  platformMocks.pickDirectory.mockClear();
  platformMocks.checkPath.mockReset().mockResolvedValue(null);
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
  window.dispatchEvent(new Event('resize'));
  localStorage.setItem('ollama_gui_projects', JSON.stringify([PROJECT]));
  localStorage.setItem('ollama_gui_active_project', PROJECT.id);
});

describe('per-session working directory (#550)', () => {
  it('loading a session adopts its own working folder as primary', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 'sw1', title: 'Feature work', messages: [{ role: 'user', content: 'hi' }], createdAt: 1, model: 'llama3', projectId: PROJECT.id, workingDir: '/repos/feature-branch' },
    ]));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'workdir-proj' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load session: Feature work' }));
    await waitFor(() => {
      const calls = workspaceMocks.openWorkspaceRoots.mock.calls;
      const last = calls[calls.length - 1]?.[0] as string[];
      expect(last?.[0]).toBe('/repos/feature-branch');
      expect(last).toContain('/repos/main');
    });
  });

  it('clicking the folder chip changes and persists this session\'s working dir', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 'sw2', title: 'Chip chat', messages: [{ role: 'user', content: 'hi' }], createdAt: 1, model: 'llama3', projectId: PROJECT.id },
    ]));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'workdir-proj' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load session: Chip chat' }));
    fireEvent.click(await screen.findByLabelText('Change session working folder'));
    await waitFor(() => {
      expect(storage.getSessions().find(s => s.id === 'sw2')?.workingDir).toBe('/tmp/other-repo');
    });
    await waitFor(() => {
      const calls = workspaceMocks.openWorkspaceRoots.mock.calls;
      expect((calls[calls.length - 1]?.[0] as string[])?.[0]).toBe('/tmp/other-repo');
    });
  });

  it('an unreachable working folder warns with a picker — and never crashes', async () => {
    workspaceMocks.openWorkspaceRoots.mockRejectedValue(new Error('No such directory: /gone/volume'));
    localStorage.setItem('ollama_gui_projects', JSON.stringify([
      { ...PROJECT, workspaceRoot: '/gone/volume', workspaceRoots: ['/gone/volume'] },
    ]));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Working folder unavailable/i);
    expect(screen.getByRole('button', { name: 'Choose a new working folder' })).toBeInTheDocument();
    // Still fully usable: the composer renders and accepts input.
    fireEvent.change(screen.getByLabelText('Type your message here'), { target: { value: 'still alive' } });
    expect((screen.getByLabelText('Type your message here') as HTMLTextAreaElement).value).toBe('still alive');
  });

  it('a proactively-detected missing folder warns precisely and skips the backend open', async () => {
    // The Rust path_exists check (#550) says the primary root is gone BEFORE
    // set_workspace_roots would reject — the banner names the exact problem
    // and openWorkspaceRoots is never handed a root we know is bad.
    platformMocks.checkPath.mockResolvedValue({ exists: false, isDir: false, readable: false });
    localStorage.setItem('ollama_gui_projects', JSON.stringify([
      { ...PROJECT, workspaceRoot: '/gone/volume', workspaceRoots: ['/gone/volume'] },
    ]));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/\/gone\/volume does not exist/i);
    expect(workspaceMocks.openWorkspaceRoots).not.toHaveBeenCalled();
    // Still fully usable: the composer renders and accepts input.
    fireEvent.change(screen.getByLabelText('Type your message here'), { target: { value: 'still alive' } });
    expect((screen.getByLabelText('Type your message here') as HTMLTextAreaElement).value).toBe('still alive');
  });

  it('a new chat resets to the project default folder', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 'sw3', title: 'Override chat', messages: [{ role: 'user', content: 'hi' }], createdAt: 1, model: 'llama3', projectId: PROJECT.id, workingDir: '/repos/feature-branch' },
    ]));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'workdir-proj' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load session: Override chat' }));
    await waitFor(() => {
      expect((workspaceMocks.openWorkspaceRoots.mock.calls.at(-1)?.[0] as string[])?.[0]).toBe('/repos/feature-branch');
    });
    fireEvent.click(screen.getByRole('button', { name: `New chat in project ${PROJECT.name}` }));
    await waitFor(() => {
      expect((workspaceMocks.openWorkspaceRoots.mock.calls.at(-1)?.[0] as string[])?.[0]).toBe('/repos/main');
    });
  });
});
