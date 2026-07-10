/**
 * Scroll-to-bottom button (#255/#258): appears when the user is scrolled up,
 * and clicking it scrolls back to the latest message and hides the button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;

function chatReply(text: string) {
  const reader = { read: vi.fn() };
  reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from(`{"message":{"content":"${text}"}}\n`) });
  reader.read.mockResolvedValueOnce({ done: true, value: undefined });
  return { ok: true, body: { getReader: () => reader } };
}

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes('/api/chat') || u.includes('generate')) return Promise.resolve(chatReply('reply') as any);
    return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
  });
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
});

describe('Scroll-to-bottom button (#255/#258)', () => {
  it('appears when scrolled up and scrolls back to bottom on click', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(composer, { target: { value: 'hi' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('reply')).toBeInTheDocument(), { timeout: 5000 });

    const container = screen.getByTestId('messages-container');
    // Simulate being scrolled up (far from the bottom).
    Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => 300 });
    Object.defineProperty(container, 'scrollTop', { configurable: true, get: () => 0 });
    fireEvent.scroll(container);

    const btn = await screen.findByRole('button', { name: /Scroll to bottom/i }, { timeout: 3000 });
    expect(btn).toBeInTheDocument();

    // Clicking scrolls to the latest message (scrollIntoView) and hides the button.
    const scrollSpy = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    fireEvent.click(btn);
    expect(scrollSpy).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Scroll to bottom/i })).not.toBeInTheDocument(), { timeout: 3000 });
    scrollSpy.mockRestore();
  }, 30000);
});
