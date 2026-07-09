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

describe('Tag filter (#306)', () => {
  it('filters sessions by tag when a tag is clicked', async () => {
    const sessions = [
      { id: 's1', title: 'Work chat', messages: [{ role: 'user', content: 'Hi' }], model: 'llama3', createdAt: Date.now() - 2000, tags: ['work'] },
      { id: 's2', title: 'Personal chat', messages: [{ role: 'user', content: 'Hello' }], model: 'llama3', createdAt: Date.now() - 1000, tags: ['personal'] },
    ];
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
    render(<App />);
    await waitFor(() => expect(screen.getByText('Work chat')).toBeInTheDocument(), { timeout: 3000 });
    // Click the 'work' tag button
    const tagBtn = screen.getByText('work');
    fireEvent.click(tagBtn);
    // The tag filter chip should appear
    expect(await screen.findByText(/work.*✕/)).toBeInTheDocument();
    // Only 'Work chat' should be visible, not 'Personal chat'
    expect(screen.getByText('Work chat')).toBeInTheDocument();
    expect(screen.queryByText('Personal chat')).not.toBeInTheDocument();
  });

  it('clears the tag filter when the chip is clicked', async () => {
    const sessions = [
      { id: 's1', title: 'Work chat', messages: [{ role: 'user', content: 'Hi' }], model: 'llama3', createdAt: Date.now() - 2000, tags: ['work'] },
      { id: 's2', title: 'Personal chat', messages: [{ role: 'user', content: 'Hello' }], model: 'llama3', createdAt: Date.now() - 1000, tags: ['personal'] },
    ];
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(sessions));
    render(<App />);
    await waitFor(() => expect(screen.getByText('work')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByText('work'));
    const chip = await screen.findByText(/work.*✕/);
    fireEvent.click(chip);
    // Both sessions should be visible again
    await waitFor(() => expect(screen.getByText('Personal chat')).toBeInTheDocument(), { timeout: 2000 });
  });
});

describe('Browser notification on completion (#307)', () => {
  it('fires a notification when generation completes and tab is hidden', async () => {
    const mockNotification = vi.fn() as any;
    mockNotification.permission = 'granted';
    (global as any).Notification = mockNotification;
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });

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
    await waitFor(() => expect(mockNotification).toHaveBeenCalledWith(
      expect.stringMatching(/Reply from/),
      expect.objectContaining({ body: expect.any(String) }),
    ), { timeout: 2000 });
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
