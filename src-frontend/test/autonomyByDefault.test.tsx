/**
 * Autonomy by default (#549 audit ranks 1, 3, 7):
 *  - Agentic mode is DERIVED: active project with a bound folder → tools on;
 *    no project → plain chat. There is no Agentic Mode setting any more.
 *  - The Plan/Ask/Auto control sits beside the model switcher, only while a
 *    project makes the agent active.
 *  - The active project persists across restarts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import App from '../App';
import { seedLocalOllama } from './helpers/providers';

const PROJECT = {
  id: 'proj_auto',
  name: 'payments-api',
  workspaceRoot: '/Users/me/repos/payments',
  workspaceRoots: ['/Users/me/repos/payments'],
  instructions: '',
  createdAt: 1_700_000_000_000,
};

beforeEach(() => {
  localStorage.clear();
    // #566: nothing is pre-configured now, so this spec adds the provider.
    seedLocalOllama();
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
  window.dispatchEvent(new Event('resize'));
});

describe('derived agentic mode (#549 rank 1)', () => {
  it('with no project: plain-chat placeholder, no autonomy control', () => {
    render(<App />);
    expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Autonomy level' })).not.toBeInTheDocument();
  });

  it('with an active folder-bound project: goal placeholder and Plan/Ask/Auto control', () => {
    localStorage.setItem('ollama_gui_projects', JSON.stringify([PROJECT]));
    localStorage.setItem('ollama_gui_active_project', PROJECT.id);
    render(<App />);
    expect(screen.getByPlaceholderText('Describe the goal for this session…')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Autonomy level' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set autonomy: auto' })).toBeInTheDocument();
  });

  it('there is no Agentic Mode toggle in Settings any more', () => {
    render(<App />);
    screen.getByText('⚙️ Settings').click();
    expect(screen.queryByLabelText('Toggle tool calling')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent Safety')).not.toBeInTheDocument();
  });
});

describe('active project persistence (#549 rank 7)', () => {
  it('restores the persisted active project on boot', () => {
    localStorage.setItem('ollama_gui_projects', JSON.stringify([PROJECT]));
    localStorage.setItem('ollama_gui_active_project', PROJECT.id);
    render(<App />);
    const row = screen.getByRole('button', { name: 'payments-api' });
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('ignores a stale persisted id whose project no longer exists', () => {
    localStorage.setItem('ollama_gui_active_project', 'proj_deleted');
    render(<App />);
    expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument();
  });
});
