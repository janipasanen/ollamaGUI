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

describe('Raw/rendered toggle per assistant message (#290)', () => {
  it('switches between rendered Markdown and raw text', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) {
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"**Hello** there"}}\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            }),
          },
        } as any;
      }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => screen.getByText('Hello'), { timeout: 3000 });

    // Rendered: the literal asterisks are not present as a single text node.
    expect(screen.queryByText('**Hello** there')).not.toBeInTheDocument();

    // Toggle to raw.
    fireEvent.click(screen.getByRole('button', { name: 'Show raw' }));
    expect(screen.getByText('**Hello** there')).toBeInTheDocument();

    // Toggle back to rendered.
    fireEvent.click(screen.getByRole('button', { name: 'Show rendered' }));
    expect(screen.queryByText('**Hello** there')).not.toBeInTheDocument();
  });
});
