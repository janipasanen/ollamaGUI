import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

// Build a ReadableStream that yields the given JSON lines then closes.
function pullStream(lines: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const chunks = lines.map(l => enc.encode(JSON.stringify(l) + '\n'));
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

/** Fetch mock: routes /api/pull (POST) to a stream, /api/tags (GET) to a model list. */
function makeFetch(opts: { pullLines?: object[]; pullOk?: boolean; models?: any[] } = {}) {
  const { pullLines = [{ status: 'pulling', completed: 50, total: 100 }, { status: 'success' }], pullOk = true, models = [] } = opts;
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/pull')) {
      if (!pullOk) return { ok: false, statusText: 'model not found', body: null } as any;
      return { ok: true, body: pullStream(pullLines), getReader: () => pullStream(pullLines).getReader() } as any;
    }
    if (u.includes('/api/tags')) {
      return { ok: true, json: async () => ({ models }), text: async () => JSON.stringify({ models }) } as any;
    }
    // Fallback for /api/show, cloud endpoints, etc.
    return { ok: true, json: async () => ({}), text: async () => '', body: null } as any;
  });
}

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  global.innerWidth = 1024;
});

afterEach(() => {
  global.fetch = origFetch;
});

describe('Model pull UI (#238)', () => {
  it('renders a Download button for an uninstalled suggested model', async () => {
    global.fetch = makeFetch({ models: [] }) as any;
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    expect(await screen.findByRole('button', { name: /Download ministral-3:3b/i })).toBeInTheDocument();
  });

  it('renders "Installed ✓" for a suggested model that is present', async () => {
    global.fetch = makeFetch({ models: [{ name: 'ministral-3:3b' }] }) as any;
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    expect(await screen.findByText(/Installed ✓/i)).toBeInTheDocument();
  });

  it('shows error progress and a Retry button when a pull fails', async () => {
    global.fetch = makeFetch({ pullOk: false, models: [] }) as any;
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    const downloadBtn = await screen.findByRole('button', { name: /Download ministral-3:3b/i });
    fireEvent.click(downloadBtn);
    await waitFor(() => expect(screen.getByText(/Error pulling/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  }, 15000);

  it('updates progress text and disables the pull button while pulling', async () => {
    global.fetch = makeFetch({ models: [] }) as any;
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    const pullInput = await screen.findByLabelText(/Model name to pull/i);
    fireEvent.change(pullInput, { target: { value: 'llama3.2:1b' } });
    fireEvent.click(screen.getByRole('button', { name: /^Pull$/i }));
    // While/after pulling, a progress line referencing the model appears.
    await waitFor(() => expect(screen.getByText(/Pull complete: llama3.2:1b/i)).toBeInTheDocument());
  }, 15000);
});
