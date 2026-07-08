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

describe('Scroll to latest via Ctrl/Cmd+End (#278)', () => {
  it('triggers a scroll-to-bottom on Ctrl+End', async () => {
    const storage = (await import('../services/storage')).storage;
    storage.saveSession({
      id: 's1', title: 'Long Chat', createdAt: 1, model: 'llama3',
      messages: Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}`, ts: i })),
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Load session: Long Chat/i }));
    await waitFor(() => expect(screen.getByText('m9')).toBeInTheDocument());

    // Clear calls recorded during load, then fire the shortcut.
    scrollSpy.mockClear();
    (document.activeElement as HTMLElement | null)?.blur?.();
    fireEvent.keyDown(window, { key: 'End', ctrlKey: true });

    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth' }));
    scrollSpy.mockRestore();
  });
});
