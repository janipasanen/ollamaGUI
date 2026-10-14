import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { seedLocalOllama } from './helpers/providers';

// ── #478: model selector shows ● for models loaded in memory ─────────────────

describe('Running model indicator (#478)', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    origFetch = global.fetch;
    localStorage.clear();
    // #566: nothing is pre-configured now, so this spec adds the provider.
    seedLocalOllama();
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
    window.dispatchEvent(new Event('resize'));
  });

  afterEach(() => {
    global.fetch = origFetch;
    localStorage.clear();
  });

  it('shows ● badge next to models loaded in Ollama memory', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { name: 'llama3:8b', size: 4e9, details: { parameter_size: '8B', quantization_level: 'Q4_0' } },
              { name: 'mistral:7b', size: 4e9, details: { parameter_size: '7B', quantization_level: 'Q4_0' } },
              { name: 'phi3:mini', size: 2e9, details: { parameter_size: '3.8B', quantization_level: 'Q4_0' } },
            ],
          }),
        });
      }
      if (url.includes('/api/ps')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { name: 'llama3:8b', model: 'llama3:8b', size: 5e9, size_vram: 4e9 },
            ],
          }),
        });
      }
      // cloud models + other endpoints
      return Promise.resolve({ ok: true, json: async () => ({}), body: null, text: async () => '' });
    }) as any;

    render(<App />);

    // Wait for the model selector to populate
    const selector = await screen.findByLabelText('Select AI model');
    expect(selector).toBeInTheDocument();

    // The llama3:8b option should have the ● warm indicator
    await waitFor(() => {
      const options = Array.from(selector.querySelectorAll('option'));
      const llamaOption = options.find(o => o.textContent?.includes('llama3:8b'));
      expect(llamaOption).toBeDefined();
      expect(llamaOption?.textContent).toContain('●');
    });

    // mistral:7b should NOT have the indicator
    const mistralOption = Array.from(selector.querySelectorAll('option')).find(
      o => o.textContent?.includes('mistral:7b'),
    );
    expect(mistralOption?.textContent).not.toContain('●');
  });

  it('shows no ● badges when no models are loaded in memory', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { name: 'llama3:8b', size: 4e9, details: {} },
              { name: 'mistral:7b', size: 4e9, details: {} },
            ],
          }),
        });
      }
      if (url.includes('/api/ps')) {
        return Promise.resolve({ ok: true, json: async () => ({ models: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}), body: null, text: async () => '' });
    }) as any;

    render(<App />);

    const selector = await screen.findByLabelText('Select AI model');
    await waitFor(() => {
      const options = Array.from(selector.querySelectorAll('option'));
      const localOptions = options.filter(o => o.textContent?.includes('llama3') || o.textContent?.includes('mistral'));
      localOptions.forEach(o => expect(o.textContent).not.toContain('●'));
    });
  });

  it('model selector title explains the ● indicator', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve({ ok: true, json: async () => ({ models: [{ name: 'llama3:8b', size: 4e9, details: {} }] }) });
      }
      if (url.includes('/api/ps')) {
        return Promise.resolve({ ok: true, json: async () => ({ models: [{ name: 'llama3:8b', model: 'llama3:8b', size: 5e9 }] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}), body: null, text: async () => '' });
    }) as any;

    render(<App />);

    const selector = await screen.findByLabelText('Select AI model');
    expect(selector.getAttribute('title')).toContain('loaded in memory');
  });
});
