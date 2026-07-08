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

describe('Edit an assistant message in place (#281)', () => {
  it('replaces the assistant reply content without re-streaming', async () => {
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) {
        chatCalls += 1;
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"Original reply"}}\n') })
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
    await waitFor(() => screen.getByText('Original reply'), { timeout: 3000 });
    expect(chatCalls).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Edit response' }));
    const editor = screen.getByDisplayValue('Original reply') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'Edited reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));

    await waitFor(() => expect(screen.getByText('Edited reply')).toBeInTheDocument());
    expect(screen.queryByText('Original reply')).not.toBeInTheDocument();
    // No new chat request was fired (in-place edit, no re-stream).
    expect(chatCalls).toBe(1);
  });

  it('Escape cancels the assistant edit', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) {
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"Original reply"}}\n') })
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
    await waitFor(() => screen.getByText('Original reply'), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'Edit response' }));
    const editor = screen.getByDisplayValue('Original reply') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'discard me' } });
    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Save edit' })).not.toBeInTheDocument();
    expect(screen.getByText('Original reply')).toBeInTheDocument();
  });
});
