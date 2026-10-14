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

describe('Regenerate last reply via Ctrl/Cmd+R (#264)', () => {
  it('re-streams the last assistant response when Ctrl+R is pressed', async () => {
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) {
        chatCalls += 1;
        const content = chatCalls === 1 ? 'First reply' : 'Second reply';
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
      return { ok: true, json: async () => ({ models: [{ name: 'llama3' }] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(composer, { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => screen.getByText('First reply'), { timeout: 5000 });
    expect(chatCalls).toBe(1);

    // Blur the composer so the global handler treats us as "not typing".
    (document.activeElement as HTMLElement | null)?.blur?.();

    fireEvent.keyDown(window, { key: 'r', ctrlKey: true });

    await waitFor(() => screen.getByText('Second reply'), { timeout: 3000 });
    expect(chatCalls).toBe(2);
  });

  it('does nothing when there is no assistant reply yet', async () => {
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) {
        chatCalls += 1;
        return { ok: true, body: { getReader: () => ({ read: vi.fn().mockResolvedValueOnce({ done: true }) }) }, } as any;
      }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    render(<App />);
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true });
    // No chat request should be fired with an empty conversation.
    expect(chatCalls).toBe(0);
  });
});
