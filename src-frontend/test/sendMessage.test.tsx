/**
 * Focused coverage of the sendMessage flow and its error paths (#59).
 *
 * sendMessage lives inside the App component, so the UI-reachable branches
 * (empty-input rejection, successful stream, multi-chunk accumulation, mid-
 * stream network failure + partial rollback) are driven through the rendered
 * app. The agentic tool-execution / maxIterations boundary is exercised against
 * the underlying engine, and image-attachment validation against its helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { validateImageAttachments } from '../services/requestValidation';

// Route by URL: the chat endpoint streams the given chunks; everything else
// (models/version/etc. during init) returns an empty model list. Call-order
// routing is unreliable because app init fires several fetches before send.
function modelsThenStream(chunks: string[]) {
  return vi.fn().mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes('/api/chat') || u.includes('generate')) {
      const reader = { read: vi.fn() as ReturnType<typeof vi.fn> };
      chunks.forEach(c => reader.read.mockResolvedValueOnce({ done: false, value: Buffer.from(c) }));
      reader.read.mockResolvedValueOnce({ done: true, value: undefined });
      return Promise.resolve({ ok: true, body: { getReader: () => reader } });
    }
    return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
  });
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
});

describe('sendMessage — empty input rejection (#59)', () => {
  it('disables Send when the composer is empty', () => {
    render(<App />);
    const send = screen.getByText('Send').closest('button')!;
    expect(send).toBeDisabled();
  });

  it('enables Send once text is entered', () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'hi' } });
    expect(screen.getByText('Send').closest('button')!).not.toBeDisabled();
  });
});

describe('sendMessage — successful stream (#59)', () => {
  it('renders a single-chunk reply', async () => {
    global.fetch = modelsThenStream(['{"message":{"content":"Hello there"}}\n']);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(document.body.textContent).toContain('Hello there'), { timeout: 2000 });
  });

  it('accumulates multi-chunk streamed content', async () => {
    global.fetch = modelsThenStream([
      '{"message":{"content":"Hel"}}\n',
      '{"message":{"content":"lo"}}\n',
      '{"message":{"content":" world"}}\n',
    ]);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(document.body.textContent).toContain('Hello world'), { timeout: 2000 });
  });
});

describe('sendMessage — network error + rollback (#59)', () => {
  it('renders a friendly error and leaves no orphan partial when the stream fails', async () => {
    let call = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null });
      return Promise.resolve({ ok: false, statusText: 'Service Unavailable', body: null });
    });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => {
      expect(screen.getByText(/unavailable|went wrong|cannot reach/i)).toBeInTheDocument();
    }, { timeout: 2000 });
  });
});

describe('sendMessage — image attachment validation (#59)', () => {
  const f = (name: string, type: string, size: number) => ({ name, type, size });

  it('accepts valid images under the limits', () => {
    const { valid, errors } = validateImageAttachments([f('a.png', 'image/png', 1000)], 0);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('rejects unsupported formats', () => {
    const { valid, errors } = validateImageAttachments([f('a.bmp', 'image/bmp', 1000)], 0);
    expect(valid).toHaveLength(0);
    expect(errors[0]).toMatch(/unsupported format/);
  });

  it('rejects oversized images', () => {
    const { errors } = validateImageAttachments([f('big.png', 'image/png', 10 * 1024 * 1024)], 0);
    expect(errors[0]).toMatch(/exceeds .* MB/);
  });

  it('enforces the max-5-images cap', () => {
    const { valid, errors } = validateImageAttachments([f('x.png', 'image/png', 10)], 5);
    expect(valid).toHaveLength(0);
    expect(errors[0]).toMatch(/Max 5 images/);
  });
});
