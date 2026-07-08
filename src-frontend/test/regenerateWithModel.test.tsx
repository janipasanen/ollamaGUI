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

const tagsJson = () => ({
  ok: true,
  json: async () => ({
    models: [
      { name: 'llama3', details: { parameter_size: '8B' } },
      { name: 'mistral', details: { parameter_size: '7B' } },
    ],
  }),
  body: null,
  text: async () => '',
}) as any;

function chatResponse(model: string) {
  const content = model === 'mistral' ? 'Mistral reply' : 'Llama reply';
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: Buffer.from(`{"message":{"content":"${content}"}}\n`) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }),
    },
  } as any;
}

describe('Regenerate with a different model (#270)', () => {
  it('re-streams the last turn with the chosen model', async () => {
    const chatRequests: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (String(url).includes('/api/chat')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        chatRequests.push(body.model ?? '?');
        return chatResponse(body.model ?? 'llama3');
      }
      if (String(url).includes('/api/tags')) return tagsJson();
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    const select = screen.getByLabelText('Select AI model') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('llama3'));

    const composer = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(composer, { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => screen.getByText('Llama reply'), { timeout: 3000 });
    expect(chatRequests).toEqual(['llama3']);

    // Open the "regenerate with a different model" picker on the assistant reply.
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate with a different model' }));
    const listbox = await screen.findByRole('listbox', { name: 'Regenerate with model' });
    // Click the mistral option by text (scoped to the picker).
    fireEvent.click(within(listbox).getByText('mistral'));

    await waitFor(() => screen.getByText('Mistral reply'), { timeout: 3000 });
    expect(chatRequests).toEqual(['llama3', 'mistral']);
    expect(select.value).toBe('mistral');
  });
});
