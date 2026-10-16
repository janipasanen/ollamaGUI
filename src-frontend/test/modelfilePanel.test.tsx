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

async function selectModel(value: string) {
  const select = screen.getByLabelText('Select AI model') as HTMLSelectElement;
  await waitFor(() => {
    const values = screen.getAllByRole('option').map(o => o.getAttribute('value'));
    expect(values).toContain(value);
  }, { timeout: 5000 });
  fireEvent.change(select, { target: { value } });
}

async function openSettings() {
  const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
  fireEvent.change(composer, { target: { value: '/settings' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument());
}

// Both the local daemon (ollamaBaseUrl) and any ollama connection answer at
// /api/tags; the OpenAI-dialect connection answers at /v1/models.
function mockModelEndpoint(kind: 'openai' | 'ollama') {
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (kind === 'openai' && u.includes('/v1/models')) {
      return { ok: true, json: async () => ({ data: [{ id: 'foo' }, { id: 'bar' }] }) } as any;
    }
    if (u.includes('/api/tags')) {
      return { ok: true, json: async () => ({ models: [{ name: 'foo' }] }) } as any;
    }
    if (u.includes('/api/create')) {
      return { ok: true, statusText: 'OK', body: new ReadableStream() } as any;
    }
    return { ok: true, json: async () => ({}) } as any;
  });
}

describe('Create Model panel — provider parity (#576)', () => {
  it('disables the whole panel for an OpenAI-dialect (LM Studio / vLLM) model', async () => {
    localStorage.setItem('model_connections', JSON.stringify([
      { id: 'conn-openai', name: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234', apiKey: 'sk-test', enabled: true },
    ]));
    mockModelEndpoint('openai');
    render(<App />);

    selectModel('conn-openai/foo');
    await openSettings();
    await waitFor(() =>
      expect((screen.getByLabelText('Select AI model') as HTMLSelectElement).value).toBe('conn-openai/foo'),
      { timeout: 5000 }
    );

    expect(screen.getByText('Create Model (Modelfile)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Model' })).toBeDisabled();
    expect(screen.getByLabelText('New model name')).toBeDisabled();
    expect(screen.getByText(/Model creation is an Ollama feature/)).toBeInTheDocument();
  });

  it('posts a bare-name FROM to the model host and forwards auth (#576)', async () => {
    localStorage.setItem('model_connections', JSON.stringify([
      { id: 'conn-ollama', name: 'Remote Ollama', kind: 'ollama', baseUrl: 'http://remote-host:11434', enabled: true },
    ]));
    let createRequest: { url?: string; headers?: Record<string, string>; body?: any } | undefined;
    global.fetch = vi.fn(async (url, opts) => {
      const u = String(url);
      if (u.includes('/v1/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as any;
      }
      if (u.includes('/api/tags')) {
        return { ok: true, json: async () => ({ models: [{ name: 'foo' }] }) } as any;
      }
      if (u.includes('/api/create')) {
        createRequest = {
          url: u,
          headers: opts?.headers as Record<string, string>,
          body: JSON.parse((opts?.body as string) ?? '{}'),
        };
        return { ok: true, statusText: 'OK', body: new ReadableStream() } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });
    render(<App />);

    selectModel('conn-ollama/foo');
    await openSettings();

    // Wait for the model selection to stabilize (avoid async mount overrides).
    const sel = screen.getByLabelText('Select AI model') as HTMLSelectElement;
    await waitFor(() => expect(sel.value).toBe('conn-ollama/foo'), { timeout: 5000 });

    fireEvent.change(screen.getByLabelText('New model name'), { target: { value: 'my-assistant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Model' }));
    await waitFor(() => expect(createRequest).toBeTruthy(), { timeout: 3000 });

    // FROM uses the bare model tag, not the connection-scoped id.
    expect(createRequest!.body.modelfile).toMatch(/^FROM foo\b/);
    expect(createRequest!.body.modelfile).not.toContain('conn-ollama');
    // Routed to the host that actually holds the model.
    expect(createRequest!.url).toContain('http://remote-host:11434/api/create');
    // Local daemon has no token, so no Authorization header is sent.
    expect(createRequest!.headers?.Authorization).toBeUndefined();
  });
});
