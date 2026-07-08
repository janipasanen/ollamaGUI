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

const modelsJson = () => ({
  ok: true,
  json: async () => ({
    models: [
      { name: 'llama3', details: { parameter_size: '8B', quantization_level: 'Q4_0' } },
      { name: 'mistral', details: { parameter_size: '7B', quantization_level: 'Q4_0' } },
    ],
  }),
  body: null,
  text: async () => '',
}) as any;

describe('/model slash command (#263)', () => {
  it('switches the active model when given a known model name', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/tags')) return modelsJson();
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    const select = screen.getByLabelText('Select AI model') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('llama3'));

    const composer = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(composer, { target: { value: '/model mistral' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(select.value).toBe('mistral'));
    expect(await screen.findByText('Switched model to mistral')).toBeInTheDocument();
  });

  it('reports the current model when called with no argument', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/tags')) return modelsJson();
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    await waitFor(() => expect((screen.getByLabelText('Select AI model') as HTMLSelectElement).value).toBe('llama3'));

    const composer = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(composer, { target: { value: '/model' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Current model: llama3')).toBeInTheDocument();
  });

  it('warns when the requested model is not found', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/tags')) return modelsJson();
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    await waitFor(() => expect((screen.getByLabelText('Select AI model') as HTMLSelectElement).value).toBe('llama3'));

    const composer = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(composer, { target: { value: '/model ghost' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Model "ghost" not found')).toBeInTheDocument();
    expect((screen.getByLabelText('Select AI model') as HTMLSelectElement).value).toBe('llama3');
  });
});
