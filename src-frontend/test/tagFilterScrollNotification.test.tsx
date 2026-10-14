/**
 * Tag filter (#306), browser completion notification (#307),
 * and scroll-to-top button (#308).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// The sidebar tag chips + filter chip were removed in the Ollama-style
// rewrite; filtering by tag now happens through sidebar search, which
// matches tags (services/storage searchSessions). Titles deliberately do
// not contain the tag words so only the tag can match.
describe('Tag filter via sidebar search (#306)', () => {
  const sessions = [
    { id: 's1', title: 'Alpha chat', messages: [{ role: 'user', content: 'Hi' }], model: 'llama3', createdAt: Date.now() - 2000, tags: ['work'] },
    { id: 's2', title: 'Beta chat', messages: [{ role: 'user', content: 'Yo' }], model: 'llama3', createdAt: Date.now() - 1000, tags: ['personal'] },
  ];

  it('filters sessions by tag when the tag is typed into search', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load session: Alpha chat' })).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'work' } });
    // Only the session tagged 'work' remains visible.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load session: Beta chat' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Load session: Alpha chat' })).toBeInTheDocument();
  });

  it('clearing the search restores all sessions', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load session: Alpha chat' })).toBeInTheDocument(), { timeout: 3000 });
    const search = screen.getByLabelText('Search conversations');
    fireEvent.change(search, { target: { value: 'personal' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load session: Alpha chat' })).not.toBeInTheDocument());
    fireEvent.change(search, { target: { value: '' } });
    // Both sessions should be visible again
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load session: Alpha chat' })).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByRole('button', { name: 'Load session: Beta chat' })).toBeInTheDocument();
  });
});

describe('Browser notification on completion (#307)', () => {
  it('fires a notification when generation completes and tab is hidden', async () => {
    const mockNotification = vi.fn() as any;
    mockNotification.permission = 'granted';
    (window as any).Notification = mockNotification;
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    localStorage.setItem('ollama_gui_notify_complete', 'true');

    const reader = { read: vi.fn() as ReturnType<typeof vi.fn> };
    reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"Hello there"}}\n') });
    reader.read.mockResolvedValueOnce({ done: true, value: undefined });
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat')) {
        return Promise.resolve({ ok: true, body: { getReader: () => reader } });
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(document.body.textContent).toContain('Hello there'), { timeout: 3000 });
    await waitFor(() => expect(mockNotification).toHaveBeenCalled(), { timeout: 3000 });
    expect(mockNotification.mock.calls[0][0]).toMatch(/Reply from/);
  });
});

describe('Scroll-to-top button (#308)', () => {
  it('shows a Scroll to top button when scrolled down', async () => {
    const sessions = [
      { id: 's1', title: 'Long chat', messages: Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i} with enough text to create height `.repeat(5),
        ts: Date.now() + i * 1000,
      })), model: 'llama3', createdAt: Date.now() },
    ];
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
    render(<App />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button', { name: /Load session: Long chat/i });
      expect(btns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: /Load session: Long chat/i })[0]);
    // Simulate scroll down
    await waitFor(() => expect(document.body.textContent).toContain('Message 0'), { timeout: 3000 });
    const container = screen.getByTestId('messages-container');
    Object.defineProperty(container, 'scrollTop', { value: 500, writable: true });
    Object.defineProperty(container, 'scrollHeight', { value: 2000, writable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, writable: true });
    fireEvent.scroll(container);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scroll to top' })).toBeInTheDocument(), { timeout: 2000 });
  });
});
