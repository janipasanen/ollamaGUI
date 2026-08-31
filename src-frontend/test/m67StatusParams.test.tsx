import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { seedLocalOllama } from './helpers/providers';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  // #566: nothing is pre-configured now, so these specs add the provider.
  seedLocalOllama();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
});

const emptyModelsFetch = () =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

// ── Connection status: sidebar Providers panel (#324, moved by #563) ─────────
// The header's single Ollama dot is gone. With several providers configurable
// it could only ever describe one of them, so status is stated per provider in
// the sidebar — as text, not just colour, so it is available to screen readers.

describe('provider connection status (#563)', () => {
  it('lists the configured provider with its status', async () => {
    global.fetch = emptyModelsFetch();
    render(<App />);
    expect(await screen.findByText('Providers', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/^Local Ollama: /)).toBeInTheDocument();
  });

  it('no longer renders the header status dot', async () => {
    global.fetch = emptyModelsFetch();
    render(<App />);
    await screen.findByText('Providers', {}, { timeout: 4000 });
    expect(screen.queryByLabelText('Ollama connection status')).not.toBeInTheDocument();
  });

  it('reports a provider that cannot be reached', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connection refused'));
    render(<App />);
    // Never fetched and never tested reads as unknown, not as broken; pressing
    // Test is what turns it into a definite verdict.
    const status = await screen.findByText(/^Local Ollama: /, {}, { timeout: 4000 });
    expect(status.textContent).toMatch(/Unknown|Not reachable/);
  });
});

// #325 (generation-parameters badge in the header) was removed with the header
// toolbar in the UI simplification — no badge surface exists anymore. The
// effective /temp and /ctx values are still asserted via /params below.

// ── #326 /params slash command ───────────────────────────────────────────────

describe('/params slash command (#326)', () => {
  it('shows all generation options with defaults', async () => {
    global.fetch = emptyModelsFetch();
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/params' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    const banner = await screen.findByText(/Temperature: default/);
    expect(banner.textContent).toContain('Context: 4096');
    expect(banner.textContent).toContain('Top-p: default');
    expect(banner.textContent).toContain('Top-k: default');
    expect(banner.textContent).toContain('Max tokens: unlimited');
    expect(banner.textContent).toContain('Stop: []');
  });

  it('reflects updated values after setting temperature and context', async () => {
    global.fetch = emptyModelsFetch();
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/temp 0.8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Temperature set to 0.8');
    fireEvent.change(composer, { target: { value: '/ctx 2048' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Context window set to 2048');
    fireEvent.change(composer, { target: { value: '/params' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    const banner = await screen.findByText(/Temperature: 0\.8/);
    expect(banner.textContent).toContain('Context: 2048');
  });
});
