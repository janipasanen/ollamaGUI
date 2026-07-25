import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  // Message deletion is confirm-gated (#448); accept the confirm in tests.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  vi.restoreAllMocks();
});

function streamReply(content: string) {
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

describe('Delete a single message (#280)', () => {
  it('removes an assistant reply via the Delete response button', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) return streamReply('Hello there');
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => screen.getByText('Hello there'), { timeout: 3000 });

    const container = screen.getByTestId('messages-container');
    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }));
    await waitFor(() => expect(within(container).queryByText('Hello there')).not.toBeInTheDocument());
    // The user message remains in the message list.
    expect(within(container).getByText('Hi')).toBeInTheDocument();
  });

  it('removes a user message via the Delete message button', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) return streamReply('Hello there');
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => screen.getByText('Hello there'), { timeout: 3000 });

    const container2 = screen.getByTestId('messages-container');
    fireEvent.click(screen.getByRole('button', { name: 'Delete message' }));
    await waitFor(() => expect(within(container2).queryByText('Hi')).not.toBeInTheDocument());
    // The assistant reply remains in the message list.
    expect(within(container2).getByText('Hello there')).toBeInTheDocument();
  });
});
