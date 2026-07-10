/**
 * Regenerate with a different model (#270): the per-message ↺▾ menu lists
 * available models; picking one regenerates that reply using the chosen model.
 */
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

function chatReader(text: string) {
  const reader = { read: vi.fn() };
  reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from(`{"message":{"content":"${text}"}}\n`) });
  reader.read.mockResolvedValueOnce({ done: true, value: undefined });
  return { ok: true, body: { getReader: () => reader } };
}

describe('Regenerate with a different model (#270)', () => {
  it('lists models and regenerates the reply with the selected model', async () => {
    const chatBodies: any[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      const u = String(url);
      if (u.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3' }, { name: 'mistral' }] }),
          body: null, text: async () => '',
        } as any);
      }
      if (u.includes('/api/chat') || u.includes('generate')) {
        if (init?.body) chatBodies.push(JSON.parse(init.body));
        return Promise.resolve(chatReader('reply') as any);
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    });

    render(<App />);
    // Wait for the model list to load so the ↺▾ button renders.
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument(), { timeout: 3000 });

    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(document.body.textContent).toContain('reply'), { timeout: 5000 });

    // Remember the model used for the first reply.
    const firstModel = chatBodies.at(-1)?.model;
    expect(firstModel).toBeTruthy();

    // Open the regenerate-with-model menu.
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate with a different model' }));
    const listbox = await screen.findByRole('listbox', { name: 'Regenerate with model' });

    // Pick mistral (scoped to the listbox — the top model <select> also has options).
    fireEvent.click(within(listbox).getByRole('option', { name: 'mistral' }));

    // The regeneration request uses the mistral model (different from the first).
    await waitFor(() => expect(chatBodies.at(-1)?.model).toBe('mistral'), { timeout: 5000 });
    expect(chatBodies.at(-1)?.model).not.toBe(firstModel);
  }, 30000);
});
