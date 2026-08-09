/**
 * First-run and trust fixes (#549 audit ranks 5, 6, 10):
 *  - disconnected state is visible above the composer with a one-click Retry
 *  - projects are renamable inline (double-click) and via the context menu
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';

const PROJECT = {
  id: 'proj_r',
  name: 'oldname',
  workspaceRoot: '/tmp/ws',
  workspaceRoots: ['/tmp/ws'],
  instructions: '',
  createdAt: 1_700_000_000_000,
};

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
  window.dispatchEvent(new Event('resize'));
});

describe('disconnected banner (#549 rank 5)', () => {
  it('shows the banner with a Retry button when Ollama is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    render(<App />);
    expect(await screen.findByText(/Ollama isn't running/i, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Ollama connection' })).toBeInTheDocument();
  });

  it('Retry reconnects when the daemon is back', async () => {
    let up = false;
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      if (!up) return Promise.reject(new Error('ECONNREFUSED'));
      return Promise.resolve({ ok: true, json: async () => ({ models: [{ name: 'llama3' }] }) });
    });
    render(<App />);
    const retry = await screen.findByRole('button', { name: 'Retry Ollama connection' }, { timeout: 4000 });
    up = true;
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.queryByText(/Ollama isn't running/i)).not.toBeInTheDocument();
    }, { timeout: 4000 });
  });
});

describe('project rename (#549 rank 10)', () => {
  it('double-click renames a project inline', async () => {
    localStorage.setItem('ollama_gui_projects', JSON.stringify([PROJECT]));
    render(<App />);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'oldname' }));
    const input = screen.getByLabelText('Rename project');
    fireEvent.change(input, { target: { value: 'payments-api' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'payments-api' })).toBeInTheDocument();
    });
    const stored = JSON.parse(localStorage.getItem('ollama_gui_projects') ?? '[]');
    expect(stored[0].name).toBe('payments-api');
  });

  it('context menu offers Rename / New chat / Delete', async () => {
    localStorage.setItem('ollama_gui_projects', JSON.stringify([PROJECT]));
    render(<App />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'oldname' }));
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });
});
