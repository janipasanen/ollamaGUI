/**
 * Live agentic status indicator (#394): while an agentic run is in progress the
 * header shows a role="status" / aria-live line with the current phase
 * ("Thinking…" / "Running: <tool>"), and clears it on completion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

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
  // Agentic mode is derived: an active project with a bound folder turns tools on.
  localStorage.setItem('ollama_gui_projects', JSON.stringify([
    { id: 'proj_t', name: 'proj', workspaceRoot: '/tmp/ws', workspaceRoots: ['/tmp/ws'], instructions: '', createdAt: 1700000000000 },
  ]));
  localStorage.setItem('ollama_gui_active_project', 'proj_t');
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
});

describe('Live agentic status indicator (#394)', () => {
  it('shows a role=status "Thinking…" line during an agentic run, then clears it', async () => {
    // Keep the stream open long enough to observe the "Thinking…" phase: a
    // content chunk, then a delayed final chunk.
    let releaseDone: () => void = () => {};
    const donePromise = new Promise<void>(r => { releaseDone = r; });
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat') || u.includes('generate')) {
        const reader = {
          read: vi.fn().mockImplementation(async () => {
            // First read: a content chunk.
            return { done: false, value: Buffer.from('{"message":{"content":"Working on it"}}\n') };
          }),
        };
        // Second read resolves once the test releases the stream.
        reader.read.mockImplementationOnce(async () => {
          await donePromise;
          return { done: true, value: undefined };
        });
        return Promise.resolve({ ok: true, body: { getReader: () => reader } });
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);
    // Agentic mode is already active via the folder-bound project (beforeEach).
    fireEvent.change(screen.getByLabelText('Type your message here'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Thinking');
    }, { timeout: 3000 });

    // Release the stream and confirm the status clears on completion.
    releaseDone();
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    }, { timeout: 3000 });
  });
});
