/**
 * System prompt presets (#315) and /pull command (#316).
 * Sidebar message counts (#317) were removed with the project-first sidebar
 * rewrite (per-session msg-count badges no longer exist), so their tests
 * were deleted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('System prompt presets (#315)', () => {
  it('shows a preset dropdown in settings that fills the system prompt', async () => {
    render(<App />);
    // Open settings with Ctrl+,
    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    const presetSelect = await screen.findByLabelText('Persona presets', {}, { timeout: 3000 });
    expect(presetSelect).toBeInTheDocument();
    // Select the coding assistant preset
    fireEvent.change(presetSelect, { target: { value: 'You are an expert software engineer. Write clean, well-structured code with comments where needed. Explain your reasoning briefly.' } });
    // The system prompt textarea should contain the preset text
    const textarea = screen.getByLabelText('System prompt');
    expect(textarea).toHaveValue('You are an expert software engineer. Write clean, well-structured code with comments where needed. Explain your reasoning briefly.');
  });
});

describe('/pull slash command (#316)', () => {
  it('rejects with usage hint when no model name is given', async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/pull' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Usage: /pull <model-name>')).toBeInTheDocument();
  });

  it('shows pulling status when a model name is given', async () => {
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/pull')) {
        return Promise.resolve({ ok: true, body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }) }) } });
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/pull llama3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText(/Pulling llama3/, {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
