import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { storage } from '../services/storage';

// Models call + one-chunk assistant reply.
function mockChat() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/api/chat')) {
      return Promise.resolve({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"answer"}}\n') })
              .mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null });
  }) as any;
}

async function sendOne() {
  fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'q' } });
  fireEvent.click(screen.getByText('Send'));
  await waitFor(() => expect(screen.getByText('answer')).toBeInTheDocument());
}

describe('Message feedback (#137)', () => {
  beforeEach(() => { localStorage.clear(); mockChat(); });
  afterEach(() => vi.restoreAllMocks());

  it('thumbs rating persists on the saved session and toggles off', async () => {
    render(<App />);
    await sendOne();

    fireEvent.click(screen.getByLabelText('Thumbs up'));
    await waitFor(() => {
      const saved = storage.getSessions()[0];
      const assistant = saved?.messages.find(m => m.role === 'assistant');
      expect(assistant?.feedback?.thumbs).toBe('up');
    });

    // Clicking the same thumb again clears it.
    fireEvent.click(screen.getByLabelText('Thumbs up'));
    await waitFor(() => {
      const assistant = storage.getSessions()[0]?.messages.find(m => m.role === 'assistant');
      expect(assistant?.feedback).toBeUndefined();
    });
  });

  it('exposes no rating-scale / export / feedback-log affordance', async () => {
    render(<App />);
    await sendOne();
    // Only thumbs — no numeric score buttons, no "Export feedback" control.
    expect(screen.queryByText(/feedback log/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/export feedback/i)).not.toBeInTheDocument();
  });
});
