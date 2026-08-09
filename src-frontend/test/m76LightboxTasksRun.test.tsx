import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { storage, type ChatSession } from '../services/storage';
import { _cliMocks } from '../services/tools';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0x8AAAAASUVORK5CYII=';

let origFetch: typeof global.fetch;

function chatStreamResponse(content: string) {
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: Buffer.from(`{"message":{"content":${JSON.stringify(content)}}}\n`) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }),
    },
  } as any;
}

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/api/chat')) return chatStreamResponse('done');
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  _cliMocks.invoke = null;
});

// ── Image lightbox (#351) ─────────────────────────────────────────────────────

describe('Image lightbox (#351)', () => {
  it('opens a full-size overlay on click and closes on Escape', async () => {
    const session: ChatSession = {
      id: 'img-1', title: 'ImgChat', createdAt: 1, model: 'llama3',
      messages: [
        { role: 'user', content: 'see this', images: [PNG] },
        { role: 'assistant', content: 'nice' },
      ],
    };
    storage.saveSession(session);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load session: ImgChat' }));

    const img = await screen.findByAltText('attachment');
    fireEvent.click(img);

    const overlay = await screen.findByRole('dialog', { name: 'Image preview' });
    expect(overlay).toBeInTheDocument();
    expect(overlay.querySelector('img')?.getAttribute('src')).toBe(PNG);

    // Close via Escape on the overlay.
    fireEvent.keyDown(overlay, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Image preview' })).not.toBeInTheDocument());
  });
});

// ── Interactive task-list checkboxes (#352) ───────────────────────────────────

describe('Interactive GFM task-list checkboxes (#352)', () => {
  it('toggles a task item when its checkbox is clicked', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '- [ ] Task one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // Wait for the streamed reply to finish so isLoading is false.
    await waitFor(() => screen.getByText('done'), { timeout: 3000 });
    const checkbox = screen.getByRole('checkbox', { name: 'Task: Task one' });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Task: Task one' })).toBeChecked(),
    );
  });
});

// ── /run shell command → chat (#353) ──────────────────────────────────────────

describe('/run feeds shell output into chat (#353)', () => {
  it('runs the command and injects its output as a user message', async () => {
    _cliMocks.invoke = async () => ({ stdout: 'hello', stderr: '', exit_code: 0, timed_out: false });

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/run echo hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Ran "echo hello" — exit 0/), { timeout: 3000 });
    // Re-query inside waitFor: the streamed assistant reply re-renders the
    // message list, which can detach a node grabbed by an earlier findByText
    // before the assertion runs.
    await waitFor(() => {
      expect(screen.getByText(/Output of/, { selector: 'p' })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('refuses with no command', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Usage: \/run <command>/));
  });
});
