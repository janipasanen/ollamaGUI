import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
});

const emptyModelsFetch = () =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

// ── #324 Ollama connection status indicator ──────────────────────────────────

describe('Ollama connection status indicator (#324)', () => {
  it('renders a status dot with an accessible label', async () => {
    global.fetch = emptyModelsFetch();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByLabelText('Ollama connection status')).toBeInTheDocument();
    });
  });

  it('shows connected (green) after models load successfully', async () => {
    global.fetch = emptyModelsFetch();
    render(<App />);
    await waitFor(() => {
      const dot = screen.getByLabelText('Ollama connection status');
      expect(dot.className).toContain('bg-emerald-500');
    });
  });

  it('shows disconnected (red) when the model fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connection refused'));
    render(<App />);
    const dot = await screen.findByLabelText('Ollama connection status');
    await waitFor(() => {
      expect(dot.className).toContain('bg-red-500');
    });
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
