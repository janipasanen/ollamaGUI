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

describe('Date separators between messages (#274)', () => {
  it('renders a separator for each new calendar day', async () => {
    const storage = (await import('../services/storage')).storage;
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(today.getDate() - 2);
    storage.saveSession({
      id: 's1', title: 'Multi Day', createdAt: 1, model: 'llama3',
      messages: [
        { role: 'user', content: 'old question', ts: twoDaysAgo.getTime() },
        { role: 'assistant', content: 'old answer', ts: twoDaysAgo.getTime() + 60_000 },
        { role: 'user', content: 'new question', ts: today.getTime() },
        { role: 'assistant', content: 'new answer', ts: today.getTime() + 60_000 },
      ],
    });

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Load session: Multi Day/i }));
    await waitFor(() => expect(screen.getByText('new answer')).toBeInTheDocument());

    // A "Today" separator should be present (the new-day messages).
    expect(screen.getByRole('separator', { name: 'Today' })).toBeInTheDocument();
    // And an absolute-date separator for the older day.
    const separators = screen.getAllByRole('separator');
    expect(separators.length).toBeGreaterThanOrEqual(2);
  });

  it('renders no separator when timestamps are missing', async () => {
    const storage = (await import('../services/storage')).storage;
    storage.saveSession({
      id: 's2', title: 'No Dates', createdAt: 1, model: 'llama3',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
      ],
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Load session: No Dates/i }));
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument());
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });
});
