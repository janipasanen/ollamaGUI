import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;
let origClipboard: typeof navigator.clipboard;

beforeEach(() => {
  origFetch = global.fetch;
  origClipboard = navigator.clipboard;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
});

afterEach(() => {
  global.fetch = origFetch;
  Object.defineProperty(navigator, 'clipboard', { value: origClipboard, configurable: true });
  localStorage.clear();
});

describe('Copy conversation as Markdown to clipboard (#261)', () => {
  it('copies the rendered Markdown to the clipboard', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) {
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"Hello there"}}\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            }),
          },
        } as any;
      }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => screen.getByText('Hello there'), { timeout: 3000 });

    // Reached via the command palette now that it is no longer header chrome (#546).
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    fireEvent.click(screen.getByText('Copy Conversation as Markdown'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('## User');
    expect(copied).toContain('Hi');
    expect(copied).toContain('## Assistant');
    expect(copied).toContain('Hello there');
  });

  it('copies nothing when the conversation is empty', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    // The header button is gone (#546); the palette entry is the desktop route.
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    fireEvent.click(screen.getByText('Copy Conversation as Markdown'));
    await waitFor(() => expect(screen.getByText(/Nothing to copy/i)).toBeInTheDocument());
    expect(writeText).not.toHaveBeenCalled();
  });
});
