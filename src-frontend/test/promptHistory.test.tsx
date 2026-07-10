/**
 * Prompt history recall (#332): non-slash prompts sent during a session are
 * recorded; Alt+Up/Alt+Down in the composer walks back/forward through them.
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
    if (u.includes('/api/chat') || u.includes('generate')) return Promise.resolve(chatReply('ok') as any);
    return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
  });
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
});

async function send(text: string) {
  const composer = screen.getByPlaceholderText('Message Ollama...');
  fireEvent.change(composer, { target: { value: text } });
  fireEvent.keyDown(composer, { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument(), { timeout: 5000 });
}

describe('Prompt history recall (#332)', () => {
  it('Alt+Up recalls previous prompts and Alt+Down moves forward / clears', async () => {
    render(<App />);
    await send('first prompt');
    await send('second prompt');

    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;

    // Alt+Up -> most recent ("second prompt")
    fireEvent.keyDown(composer, { key: 'ArrowUp', altKey: true });
    await waitFor(() => expect(composer.value).toBe('second prompt'), { timeout: 3000 });

    // Alt+Up again -> older ("first prompt")
    fireEvent.keyDown(composer, { key: 'ArrowUp', altKey: true });
    await waitFor(() => expect(composer.value).toBe('first prompt'), { timeout: 3000 });

    // Alt+Down -> back to "second prompt"
    fireEvent.keyDown(composer, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(composer.value).toBe('second prompt'), { timeout: 3000 });

    // Alt+Down past the end -> composer cleared
    fireEvent.keyDown(composer, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(composer.value).toBe(''), { timeout: 3000 });
  }, 30000);

  it('does not record slash-command prompts', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/help' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument(), { timeout: 5000 });

    // No history recorded -> Alt+Up is a no-op (composer stays empty).
    fireEvent.change(composer, { target: { value: '' } });
    fireEvent.keyDown(composer, { key: 'ArrowUp', altKey: true });
    expect(composer.value).toBe('');
  }, 30000);
});
