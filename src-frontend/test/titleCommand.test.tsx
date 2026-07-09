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

describe('/title slash command (#287)', () => {
  it('regenerates the conversation title from its content', async () => {
    const storage = (await import('../services/storage')).storage;
    storage.saveSession({
      id: 's1', title: 'Old Title', createdAt: 1, model: 'llama3',
      messages: [
        { role: 'user', content: 'The real topic is quantum computing' },
        { role: 'assistant', content: 'Interesting!' },
      ],
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Load session: Old Title/i }));
    await waitFor(() => expect(screen.getByText('Interesting!')).toBeInTheDocument());

    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // generateTitle takes the first sentence up to 60 chars -> "The real topic is quantum computing"
    expect(await screen.findByText('Retitled conversation to "The real topic is quantum computing"')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Load session: The real topic is quantum computing/i })).toBeInTheDocument();
  });
});
