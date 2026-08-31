/**
 * First-run and trust fixes (#549 audit ranks 6, 10):
 *  - an unreachable provider is reported in the sidebar's Providers panel
 *  - projects are renamable inline (double-click) and via the context menu
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';
import { seedLocalOllama } from './helpers/providers';

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

describe('unreachable provider (#562, #563)', () => {
  // The red "Ollama isn't running" banner and its 30s auto-reconnect are gone
  // (#562): they assumed Ollama is the only provider, so a user running purely
  // on vLLM or LM Studio saw a permanent error about a daemon they never use.
  // Reachability is now per provider, in the sidebar panel, re-tested on demand.
  it('reports the provider as unreachable instead of showing an Ollama banner', async () => {
    seedLocalOllama();
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    render(<App />);
    expect(await screen.findByText('Providers', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/Ollama isn't running/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry Ollama connection' })).not.toBeInTheDocument();
  });

  it('offers a per-provider Test button rather than reconnecting on a timer', async () => {
    seedLocalOllama();
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    render(<App />);
    expect(await screen.findByLabelText('Test connection to Local Ollama', {}, { timeout: 4000 }))
      .toBeInTheDocument();
  });

  it('says so plainly when no provider is configured at all', async () => {
    // A fresh install (#566) contacts nothing and must state that, rather than
    // blaming a daemon the user may never have installed.
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    render(<App />);
    expect(await screen.findByText(/No providers configured/i, {}, { timeout: 4000 }))
      .toBeInTheDocument();
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
