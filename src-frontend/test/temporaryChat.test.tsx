import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { storage } from '../services/storage';

// Branch by URL (StrictMode can double-invoke the init effect, so a call counter is unreliable).
function mockChat() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/api/chat')) {
      return Promise.resolve({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"hi"}}\n') })
              .mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null });
  }) as any;
}

describe('Temporary chat (#134)', () => {
  beforeEach(() => { localStorage.clear(); mockChat(); });
  afterEach(() => vi.restoreAllMocks());

  it('does not persist to storage and shows the banner', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession');
    render(<App />);
    fireEvent.click(screen.getByLabelText('Start temporary chat'));
    expect(screen.getByText(/won't be saved/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(screen.getByText('hi')).toBeInTheDocument());
    expect(saveSpy).not.toHaveBeenCalled();
    expect(storage.getSessions()).toHaveLength(0);
  });

  it('"Save this chat" promotes to a persisted session exactly once', async () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Start temporary chat'));
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText('hi')).toBeInTheDocument());

    const saveSpy = vi.spyOn(storage, 'saveSession');
    fireEvent.click(screen.getByText('Save this chat'));
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/won't be saved/)).not.toBeInTheDocument();
  });

  it('Discard drops the temporary chat without persisting', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession');
    render(<App />);
    fireEvent.click(screen.getByLabelText('Start temporary chat'));
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText('hi')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Discard'));
    expect(screen.queryByText(/won't be saved/)).not.toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
