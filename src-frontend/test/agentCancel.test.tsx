/**
 * Agentic cancel-keep-partial (#405): pressing Stop during an agentic run
 * aborts cleanly — the partial assistant reply is marked "(generation
 * cancelled)" and NO error banner appears (parity with normal streaming #257).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  localStorage.setItem('ollama_gui_agent_autonomy', JSON.stringify({
    level: 'auto', maxIterations: 20, readOnly: false, smartApprove: false,
  }));
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
});

describe('Agentic cancel-keep-partial (#405)', () => {
  it('Stop during an agentic run marks the partial reply cancelled and shows no error banner', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        return {
          ok: true,
          body: {
            getReader: () => {
              let first = true;
              return {
                read: () => {
                  if (first) {
                    first = false;
                    return Promise.resolve({
                      done: false,
                      value: Buffer.from('{"message":{"content":"Working on it"}}\n'),
                    });
                  }
                  // Second read hangs until the abort signal fires, then rejects.
                  return new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () =>
                      reject(new DOMException('aborted', 'AbortError')));
                  });
                },
              };
            },
          },
        } as any;
      }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    // Enable agentic (tool-calling) mode.
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle tool calling' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });

    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // Wait until the partial content renders, then the Cancel button appears.
    await waitFor(() => expect(screen.getByText(/Working on it/i)).toBeInTheDocument(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel generation' })).toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel generation' }));

    // Partial reply is marked cancelled.
    await waitFor(() => expect(screen.getByText(/generation cancelled/i)).toBeInTheDocument(), { timeout: 3000 });
    // No error banner surfaced for the abort.
    expect(screen.queryByText(/Error: aborted/i)).not.toBeInTheDocument();
    // Generation ended -> Send button returns.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument(), { timeout: 3000 });
  }, 30000);
});
