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

describe('Multi-line composer (#259)', () => {
  it('renders a textarea composer (not a single-line input)', () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...');
    expect(composer.tagName).toBe('TEXTAREA');
  });

  it('Shift+Enter does not send (Enter-to-send only)', () => {
    streamReply('ok');
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'Hello' } });
    // Shift+Enter should not trigger a send.
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
    // No generation started: Send button still present, Cancel absent, draft retained.
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel generation' })).not.toBeInTheDocument();
    expect(composer.value).toBe('Hello');
  });

  it('Enter sends the message', async () => {
    streamReply('Reply');
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'Hello' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    // The user message is added to the chat immediately on send.
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('preserves a multi-line value typed into the composer', () => {
    streamReply('ok');
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'line1\nline2' } });
    expect(composer.value).toBe('line1\nline2');
  });
});
