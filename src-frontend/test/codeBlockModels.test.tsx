/**
 * Collapsible code blocks (#312), model info in selector (#313),
 * and /models command (#314).
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

describe('Collapsible code blocks (#312)', () => {
  it('shows a Show all button on long code blocks and expands on click', async () => {
    const longCode = 'Line of code\n'.repeat(25).trim();
    const content = '```python\n' + longCode + '\n```';
    const chunk = JSON.stringify({ message: { content } });
    global.fetch = modelsThenStream([chunk]);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Show me code' } });
    fireEvent.click(screen.getByText('Send'));
    // Wait for content to appear
    await waitFor(() => expect(document.body.textContent).toContain('Line of code'), { timeout: 5000 });
    await screen.findByRole('button', { name: /Show all/ }, { timeout: 5000 });
    // Wait for the stream to fully finish (the Cancel button flips back to
    // Send) so the click below targets a settled DOM node.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument(), { timeout: 5000 });
    // The markdown `components` mapping is memoized now, so post-stream App
    // re-renders no longer remount CodeBlock; the retry loop is kept as a
    // belt-and-braces guard against unrelated render races on slow runners.
    await waitFor(() => {
      const showAll = screen.queryByRole('button', { name: /Show all/ });
      if (showAll) fireEvent.click(showAll);
      expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
    }, { timeout: 5000 });
  });
});

describe('Model info in selector (#313)', () => {
  it('shows parameter size and quantization in the model dropdown', async () => {
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [{
              name: 'llama3',
              size: 4000000000,
              details: { parameter_size: '8B', quantization_level: 'Q4_K_M' },
            }],
          }),
          body: null, text: async () => '',
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });
    render(<App />);
    const selector = await screen.findByLabelText('Select AI model', {}, { timeout: 3000 });
    const options = Array.from(selector.querySelectorAll('option'));
    const llamaOpt = options.find(o => o.textContent?.includes('llama3'));
    expect(llamaOpt).toBeTruthy();
    expect(llamaOpt!.textContent).toContain('8B');
    expect(llamaOpt!.textContent).toContain('Q4_K_M');
  });
});

describe('/models slash command (#314)', () => {
  it('lists available models in the status banner', async () => {
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [{
              name: 'llama3',
              size: 4000000000,
              details: { parameter_size: '8B', quantization_level: 'Q4_K_M' },
            }],
          }),
          body: null, text: async () => '',
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });
    render(<App />);
    // Wait for models to load
    await waitFor(() => {
      const selector = screen.getByLabelText('Select AI model');
      expect(selector.querySelector('option[value="llama3"]')).toBeTruthy();
    }, { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/models' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText(/Local \(1\)/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getAllByText(/llama3/).length).toBeGreaterThan(0);
  });

  it('rejects when no models are available', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/models' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('No models available — check your Ollama connection')).toBeInTheDocument();
  });
});
