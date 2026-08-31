import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from '../App';
import { seedLocalOllama } from './helpers/providers';

// MLX is auto-detected now (no settings). Pretend this machine supports it so
// the switcher groups MLX models and shows the ⚡ badge for a selected -mlx model.
vi.mock('../services/mlx', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    checkMlxAvailable: vi.fn(async () => ({
      available: true, apple_silicon: true, mlx_lm: true,
      python: 'python3', version: '0.20.0', reason: 'ok',
    })),
  };
});

const PROJECTS = [
  { id: 'proj_1', name: 'payments', workspaceRoot: '', instructions: '', createdAt: 1 },
  { id: 'proj_2', name: 'website', workspaceRoot: '', instructions: '', createdAt: 2 },
];
const SESSIONS = [
  { id: 's1', title: 'Fix login bug', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello there' }], createdAt: 30, model: 'llama3', projectId: 'proj_1' },
  { id: 's2', title: 'Add dark mode', messages: [], createdAt: 20, model: 'llama3', projectId: 'proj_1' },
  { id: 's3', title: 'Scratch ideas', messages: [], createdAt: 10, model: 'llama3' },
];

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
    // #566: nothing is pre-configured now, so this spec adds the provider.
    seedLocalOllama();
  localStorage.setItem('ollama_gui_projects', JSON.stringify(PROJECTS));
  localStorage.setItem('ollama_gui_sessions', JSON.stringify(SESSIONS));
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockImplementation(async (input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (url.includes('/api/tags')) {
      return {
        ok: true,
        json: async () => ({ models: [{ name: 'qwen3.5:4b-mlx' }, { name: 'llama3' }] }),
      } as any;
    }
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  vi.clearAllMocks();
});

describe('Project-first sidebar: sessions nested under projects', () => {
  it('hides a project’s sessions until its row is expanded', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /New project from a folder/i });

    expect(screen.queryByRole('button', { name: 'Load session: Fix login bug' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'payments' }));
    expect(await screen.findByRole('button', { name: 'Load session: Fix login bug' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load session: Add dark mode' })).toBeInTheDocument();

    // Collapsing hides them again.
    fireEvent.click(screen.getByRole('button', { name: 'payments' }));
    expect(screen.queryByRole('button', { name: 'Load session: Fix login bug' })).not.toBeInTheDocument();
  });

  it('loads a nested session on click and adopts its project scope', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'payments' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load session: Fix login bug' }));

    // Re-query inside waitFor: async post-load work (e.g. effective-context
    // resolution) re-renders the message list, which can detach a node grabbed
    // by findByText before the assertion runs.
    await waitFor(() => {
      expect(screen.getByText('hello there')).toBeInTheDocument();
    }, { timeout: 3000 });
    const header = await screen.findByTestId('project-header');
    expect(within(header).getByRole('heading', { name: 'payments' })).toBeInTheDocument();
  });

  it('lists sessions without a project under a separate Chats group', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /New project from a folder/i });
    expect(screen.getByText('Chats')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load session: Scratch ideas' })).toBeInTheDocument();
  });

  it('starts a new chat scoped to a project via the row’s + button', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /New project from a folder/i });
    fireEvent.click(screen.getByRole('button', { name: 'New chat in project website' }));

    const header = await screen.findByTestId('project-header');
    expect(within(header).getByRole('heading', { name: 'website' })).toBeInTheDocument();
    // Fresh chat: the welcome screen is back.
    expect(await screen.findByText(/What can I help you with today\?/i)).toBeInTheDocument();
  });
});

describe('+ New requires picking a project', () => {
  it('opens a project picker menu and starts the chat in the chosen project', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start new chat' }));

    const menu = await screen.findByRole('menu', { name: 'New chat in project' });
    expect(within(menu).getByText(/payments/)).toBeInTheDocument();
    expect(within(menu).getByText(/No project/)).toBeInTheDocument();

    fireEvent.click(within(menu).getByText(/website/));
    const header = await screen.findByTestId('project-header');
    expect(within(header).getByRole('heading', { name: 'website' })).toBeInTheDocument();
  });
});

describe('Model switcher below the composer (#544)', () => {
  it('renders the selector under the chat input with the MLX group first', async () => {
    render(<App />);
    const select = await screen.findByLabelText('Select AI model');
    // It sits BELOW the composer in DOM order.
    const composer = screen.getByPlaceholderText('Message Ollama...');
    expect(composer.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await waitFor(() => {
      const groups = Array.from(select.querySelectorAll('optgroup')).map(g => g.getAttribute('label') ?? '');
      expect(groups.some(l => l.includes('MLX (recommended)'))).toBe(true);
    });
  });

  it('shows the ⚡ MLX badge automatically when the selected local model is an MLX model', async () => {
    render(<App />);
    const select = await screen.findByLabelText('Select AI model');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: 'qwen3.5:4b-mlx' } });
    expect(await screen.findByText('⚡ MLX')).toBeInTheDocument();

    // And it disappears for a non-MLX model — no toggles involved.
    fireEvent.change(select, { target: { value: 'llama3' } });
    await waitFor(() => expect(screen.queryByText('⚡ MLX')).not.toBeInTheDocument());
  });
});

describe('Minimal header (no top-right buttons, no right dock)', () => {
  it('has no buttons in the header on desktop', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /New project from a folder/i });
    const header = document.querySelector('header')!;
    expect(header.querySelectorAll('button').length).toBe(0);
  });

  it('never renders a side dock', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /New project from a folder/i });
    expect(document.querySelector('[data-testid="side-dock"]')).toBeNull();
    expect(document.querySelector('[data-testid="panel-shell"]')).toBeNull();
  });
});
