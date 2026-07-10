/**
 * Up-arrow edits the last user message (#267, ChatGPT/Cursor quick-edit parity):
 * pressing ArrowUp in an empty composer opens inline edit on the most recent
 * user message; submitting re-sends the edited prompt (creating a branch).
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

describe('Up-arrow edits last user message (#267)', () => {
  it('opens inline edit on ArrowUp and re-sends the edited prompt', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(composer, { target: { value: 'hello' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('reply')).toBeInTheDocument(), { timeout: 5000 });

    // ArrowUp in an empty composer opens edit on the last user message.
    fireEvent.change(composer, { target: { value: '' } });
    fireEvent.keyDown(composer, { key: 'ArrowUp' });

    const editBox = await screen.findByDisplayValue('hello') as HTMLTextAreaElement;
    expect(screen.getByRole('button', { name: 'Send edit' })).toBeInTheDocument();

    // Edit and submit.
    fireEvent.change(editBox, { target: { value: 'hello edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send edit' }));

    // The edited prompt is re-sent (a new user message with the edited text).
    await waitFor(() => expect(screen.getByText('hello edited')).toBeInTheDocument(), { timeout: 5000 });
  }, 30000);

  it('ArrowUp does nothing while a generation is in progress', async () => {
    let release: () => void = () => {};
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        const reader = { read: vi.fn() };
        reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"reply"}}\n') });
        reader.read.mockImplementationOnce(async () => {
          await new Promise<void>(r => { release = r; });
          return { done: true, value: undefined };
        });
        return Promise.resolve({ ok: true, body: { getReader: () => reader } } as any);
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    });

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(composer, { target: { value: 'hello' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('reply')).toBeInTheDocument(), { timeout: 5000 });

    // Still loading: ArrowUp must not open edit mode.
    fireEvent.change(composer, { target: { value: '' } });
    fireEvent.keyDown(composer, { key: 'ArrowUp' });
    expect(screen.queryByRole('button', { name: 'Send edit' })).not.toBeInTheDocument();

    release();
  }, 30000);
});
