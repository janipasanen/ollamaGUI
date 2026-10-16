import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

async function openSettings() {
  const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
  fireEvent.change(composer, { target: { value: '/settings' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument(), { timeout: 5000 });
}

function connectionRow(name: string): HTMLElement {
  const matches = screen.getAllByText(name);
  const row = matches[0].closest('div[class*="px-3 py-2"]') as HTMLElement | null;
  if (!row) throw new Error(`row for "${name}" not found`);
  return row;
}

/** Mock the connection host's /v1/models (openai dialect). */
function mockOpenAi(status: 200 | 401 | 404, body: unknown) {
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/v1/models')) {
      const json = body === undefined ? async () => ({}) : async () => body;
      return { ok: status === 200, status, statusText: status === 200 ? 'OK' : status === 401 ? 'Unauthorized' : 'Not Found', json } as any;
    }
    // Local Ollama (mount) and anything else — no models, no crash.
    if (u.includes('/api/tags')) return { ok: true, json: async () => ({ models: [] }) } as any;
    return { ok: true, json: async () => ({}) } as any;
  });
}

describe('connection Test reports what the server said (#589)', () => {
  it('reachable-but-empty OpenAI connection → "empty", NOT a failure', async () => {
    // Deliberately OFF: the old code derived "error" from a zero model count,
    // so an empty-but-reachable server was misreported as down.
    localStorage.setItem('model_connections', JSON.stringify([
      { id: 'oa-empty', name: 'lm-studio-empty', kind: 'openai', baseUrl: 'http://lm:1234', apiKey: 'k', enabled: false },
    ]));
    mockOpenAi(200, { data: [] });
    render(<App />);
    await openSettings();

    const btn = within(connectionRow('lm-studio-empty')).getByRole('button', { name: 'Test' });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(screen.getByText('Connected — 0 models (pull or load one)')).toBeInTheDocument(),
      { timeout: 5000 }
    );
    // No red "Could not fetch models" failure is shown for a reachable host.
    expect(screen.queryByText('✗ Could not fetch models')).not.toBeInTheDocument();
  });

  it('401 connection → surfaces the real reason (not a bare failure)', async () => {
    localStorage.setItem('model_connections', JSON.stringify([
      { id: 'oa-401', name: 'lm-studio-401', kind: 'openai', baseUrl: 'http://lm:1234', apiKey: '', enabled: true },
    ]));
    mockOpenAi(401, { error: { message: 'Invalid API key provided' } });
    render(<App />);
    await openSettings();

    const btn = within(connectionRow('lm-studio-401')).getByRole('button', { name: 'Test' });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(screen.getByText(/Invalid API key provided|401/)).toBeInTheDocument(),
      { timeout: 5000 }
    );
  });
});
