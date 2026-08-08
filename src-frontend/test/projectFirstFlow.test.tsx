import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from '../App';
import { storage } from '../services/storage';

const PICKED = '/Users/me/repos/payments';

vi.mock('../services/platform', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, pickDirectory: vi.fn(async () => PICKED), probeBinary: vi.fn(async () => false) };
});

// The workspace root is pushed to Rust; stub the IPC for jsdom.
vi.mock('../services/fileTools', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return actual;
});

let origFetch: typeof global.fetch;

beforeEach(async () => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1440, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  const fileTools = await import('../services/fileTools');
  (fileTools as any)._mocks.invoke = vi.fn(async () => undefined);
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ models: [] }), body: null, text: async () => '',
  } as any);
});

afterEach(async () => {
  global.fetch = origFetch;
  const fileTools = await import('../services/fileTools');
  (fileTools as any)._mocks.invoke = null;
  localStorage.clear();
  vi.clearAllMocks();
});

describe('Project-first flow (#542)', () => {
  it('creates a project straight from the folder picker, with no name dialog', async () => {
    render(<App />);
    const add = await screen.findByRole('button', { name: /New project from a folder/i });
    fireEvent.click(add);

    // Named from the folder, active, and listed in the rail — no intermediate form.
    await waitFor(() => expect(storage.getProjects()).toHaveLength(1));
    const proj = storage.getProjects()[0];
    expect(proj.name).toBe('payments');
    expect(proj.workspaceRoot).toBe(PICKED);
    expect(proj.workspaceRoots).toEqual([PICKED]);

    // The old flow put a "Project name…" field on screen first; it must be gone.
    expect(screen.queryByPlaceholderText('Project name…')).not.toBeInTheDocument();
  });

  it('shows the bound folder on the project row so the rail answers "which repo"', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /New project from a folder/i }));
    // Exact name: "New chat in project payments" / "Delete project payments" also match /payments/i.
    const row = await screen.findByRole('button', { name: 'payments' });
    await waitFor(() => expect(row).toHaveAttribute('title', PICKED));
  });

  it('switches to the existing project instead of duplicating it when the same folder is picked twice', async () => {
    render(<App />);
    const add = await screen.findByRole('button', { name: /New project from a folder/i });
    fireEvent.click(add);
    await waitFor(() => expect(storage.getProjects()).toHaveLength(1));

    fireEvent.click(add);
    await waitFor(() => expect(screen.getByText(/Switched to "payments"/i)).toBeInTheDocument());
    expect(storage.getProjects()).toHaveLength(1);
  });

  it('does not create a project when the picker is cancelled', async () => {
    const platform = await import('../services/platform');
    (platform.pickDirectory as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /New project from a folder/i }));
    await waitFor(() => expect(screen.getByText('Projects')).toBeInTheDocument());
    expect(storage.getProjects()).toHaveLength(0);
  });
});

describe('Project header shows context (#543)', () => {
  it('renders the project name and folder chip once a project is active', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /New project from a folder/i }));

    const header = await screen.findByTestId('project-header');
    // Name and folder legitimately read the same here — the project is named
    // FROM the folder — so target the heading rather than the bare text.
    expect(within(header).getByRole('heading', { name: 'payments' })).toBeInTheDocument();
    expect(screen.getByTestId('project-folder-chip')).toHaveTextContent('payments');
  });

  it('is absent while no project is active', () => {
    render(<App />);
    expect(screen.queryByTestId('project-header')).not.toBeInTheDocument();
  });
});

describe('Rail visibility (#545)', () => {
  it('shows the rail on desktop without any interaction, and offers no hamburger', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: /New project from a folder/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Toggle sidebar/i })).not.toBeInTheDocument();
  });

  it('keeps the hamburger below the mobile breakpoint, where the rail cannot share the width', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 500, writable: true, configurable: true });
    render(<App />);
    window.dispatchEvent(new Event('resize'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Toggle sidebar/i })).toBeInTheDocument());
  });
});

describe('Header simplification (#546)', () => {
  it('no longer carries copy/export/shortcuts as global chrome', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /New project from a folder/i });
    const header = document.querySelector('header')!;
    const labels = [...header.querySelectorAll('button')]
      .map(b => b.getAttribute('aria-label') ?? '');
    expect(labels).not.toContain('Copy conversation as Markdown');
    expect(labels).not.toContain('Export conversation as Markdown');
    expect(labels).not.toContain('Show keyboard shortcuts');
  });
});
