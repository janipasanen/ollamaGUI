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

// ── #325 Generation parameters badge in header ───────────────────────────────

describe('Generation parameters badge (#325)', () => {
  it('renders the badge with default temperature and context', async () => {
    global.fetch = emptyModelsFetch();
    render(<App />);
    const badge = await screen.findByLabelText('Generation parameters');
    expect(badge.textContent).toContain('T:def');
    expect(badge.textContent).toContain('CTX:4096');
  });

  it('updates the badge after /temp sets a value', async () => {
    global.fetch = emptyModelsFetch();
    render(<App />);
    await screen.findByLabelText('Generation parameters');
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/temp 0.3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => {
      const badge = screen.getByLabelText('Generation parameters');
      expect(badge.textContent).toContain('T:0.3');
    });
  });

  it('updates the badge after /ctx sets a value', async () => {
    global.fetch = emptyModelsFetch();
    render(<App />);
    await screen.findByLabelText('Generation parameters');
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/ctx 16384' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => {
      const badge = screen.getByLabelText('Generation parameters');
      expect(badge.textContent).toContain('CTX:16384');
    });
  });
});

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
