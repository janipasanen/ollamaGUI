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

// Force the messages container to report a "scrolled up" geometry so
// isNearBottom() is false (scrollHeight - scrollTop - clientHeight > 60).
function forceScrolledUp() {
  const container = document.querySelector('[data-testid="messages-container"]') as HTMLElement;
  if (!container) return;
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => 1000 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => 200 });
  Object.defineProperty(container, 'scrollTop', { configurable: true, get: () => 0, set: () => {} });
}

function streamReply(content: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/api/chat')) {
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
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
}

describe('New-messages unread badge (#255)', () => {
  it('shows a new-messages badge on the scroll-to-bottom button when messages arrive while scrolled up', async () => {
    streamReply('Hello there');
    render(<App />);
    const container = await waitFor(() => document.querySelector('[data-testid="messages-container"]') as HTMLElement);
    forceScrolledUp();
    // Trigger a scroll so the scroll-to-bottom button is shown (scrolled-up state).
    fireEvent.scroll(container);

    const input = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(input, { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // The scroll-to-bottom button should appear with a "new" badge.
    const btn = await waitFor(() => screen.getByRole('button', { name: /Scroll to bottom.*new messages/i }), { timeout: 3000 });
    expect(btn.textContent).toMatch(/new/);
  });

  it('clears the badge after scrolling back to the bottom', async () => {
    streamReply('Reply');
    render(<App />);
    const container = await waitFor(() => document.querySelector('[data-testid="messages-container"]') as HTMLElement);
    forceScrolledUp();
    fireEvent.scroll(container);

    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    const btn = await waitFor(() => screen.getByRole('button', { name: /Scroll to bottom.*new messages/i }), { timeout: 3000 });
    expect(btn.textContent).toMatch(/new/);

    // Simulate scrolling back to the bottom (near-bottom geometry) -> badge clears.
    Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(container, 'scrollTop', { configurable: true, get: () => 0, set: () => {} });
    fireEvent.scroll(container);

    // After scrolling to the bottom, the button either unmounts or loses the badge.
    await waitFor(() => {
      const stillThere = screen.queryByRole('button', { name: /Scroll to bottom.*new messages/i });
      const plain = screen.queryByRole('button', { name: 'Scroll to bottom' });
      expect(stillThere === null || (plain && !/new/.test(plain.textContent || ''))).toBe(true);
    });
  });
});
