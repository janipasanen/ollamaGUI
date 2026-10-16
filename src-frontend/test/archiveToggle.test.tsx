import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
});

describe('Archived conversation reachability (#615)', () => {
  const seed = async () => {
    const { storage } = await import('../services/storage');
    storage.saveSession({
      id: 's1', title: 'Seed Chat', createdAt: 1, model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }],
    });
  };

  it('archive hides from History, /archived shows it, unarchive restores it', async () => {
    await seed();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;

    // 1. Seeded conversation is present in the normal History list.
    expect(await screen.findByRole('button', { name: /Load session: Seed Chat/i })).toBeInTheDocument();

    // 2. Archive it via the row's archive button.
    fireEvent.click(screen.getByRole('button', { name: 'Archive session: Seed Chat' }));

    // 3. It is no longer shown in the normal (non-archived) list.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Load session: Seed Chat/i })).not.toBeInTheDocument());

    // 4. /archived reveals the archived view (and the row reappears).
    fireEvent.change(composer, { target: { value: '/archived' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Showing archived chats')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Load session: Seed Chat/i })).toBeInTheDocument();

    // 5. Unarchive it back via the archived row's unarchive button.
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive session: Seed Chat' }));

    // 6. Toggle the archived view off; the now-active chat is visible again.
    fireEvent.change(composer, { target: { value: '/archived' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Showing active chats')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Load session: Seed Chat/i })).toBeInTheDocument();
  });
});
