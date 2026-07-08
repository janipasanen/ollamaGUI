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

describe('Escape cancels an in-progress generation (#257)', () => {
  it('pressing Escape during generation aborts the stream and marks it cancelled', async () => {
    // A stream that hangs until the abort signal fires.
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      if (String(url).includes('/api/chat')) {
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: () => new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
              }),
            }),
          },
        } as any;
      }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // Wait until generation is in progress (the Send button becomes Cancel).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel generation' })).toBeInTheDocument(), { timeout: 3000 });

    // Press Escape to cancel (dispatch on window like the global handler).
    fireEvent.keyDown(window, { key: 'Escape' });

    // The assistant message should be marked as cancelled.
    await waitFor(() => expect(screen.getByText(/generation cancelled/i)).toBeInTheDocument(), { timeout: 3000 });
    // Generation ended -> Send button returns.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument(), { timeout: 3000 });
  });

  it('Escape does not cancel when settings overlay is open (closes the overlay instead)', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      if (String(url).includes('/api/chat')) {
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: () => new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
              }),
            }),
          },
        } as any;
      }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel generation' })).toBeInTheDocument(), { timeout: 3000 });

    // Open settings while generating.
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument();

    // Escape should close settings, not cancel generation.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: /^Settings$/i })).not.toBeInTheDocument());
    // Generation still in progress.
    expect(screen.getByRole('button', { name: 'Cancel generation' })).toBeInTheDocument();
  });
});
