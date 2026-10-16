import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { createMemoryKnowledgeDB, setKnowledgeDB, type KnowledgeDB } from '../services/db';
import { setEmbedFn } from '../services/rag';
import { addFile } from '../services/knowledge';
import { _mocks as webfetchMocks } from '../services/webfetch';

/**
 * Regression for #616: when a `#` context chip is pending, a slash command
 * (/clear, /new, /model, …) must still be dispatched, never prepended to the
 * chip text and sent to the model as chat.
 */
describe('slash command with a pending context chip (#616)', () => {
  let origFetch: typeof global.fetch;

  let db: KnowledgeDB;

  beforeEach(() => {
    origFetch = global.fetch;
    localStorage.clear();
    db = createMemoryKnowledgeDB();
    setKnowledgeDB(db);
    setEmbedFn(async (texts) => texts.map(() => [1, 0, 0, 0]));
    webfetchMocks.fetchUrl = null;
  });

  afterEach(() => {
    global.fetch = origFetch;
    localStorage.clear();
    setEmbedFn(null as unknown as (t: string[]) => Promise<number[][]>);
  });

  it('dispatches /clear instead of sending it to the model when a chip is pending', async () => {
    // Seed the knowledge DB so the `#` dropdown offers a file; clicking it
    // builds a pending context block in the App (same DB instance).
    await db.saveCollection({ id: 'col1', name: 'Col', createdAt: 1, updatedAt: 1 });
    await addFile('col1', 'doc.txt', 'text/plain', 40, 'the quick brown fox');

    const chatBodies: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/chat')) {
        chatBodies.push(String(init?.body ?? ''));
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"Reply text"}}\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            }),
          },
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as unknown as Response;
    });

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;

    // 1. Create a pending `#` context chip by clicking the seeded file option.
    fireEvent.change(composer, { target: { value: '#' } });
    await waitFor(() => expect(screen.getByText('doc.txt')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByText('doc.txt'));
    await waitFor(() => expect(screen.getByText('#context 1')).toBeInTheDocument());

    // 2. Type a slash command while the chip is pending and send it.
    fireEvent.change(composer, { target: { value: '/clear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // 3. The command must have dispatched: nothing reaches /api/chat and the
    //    composer is reset by the /clear handler.
    await waitFor(() => expect(composer.value).toBe(''), { timeout: 3000 });
    const modelCalls = chatBodies.length;
    expect(modelCalls).toBe(0);
  });

  it('still prepends a pending # block to ordinary prose (not a command)', async () => {
    await db.saveCollection({ id: 'col1', name: 'Col', createdAt: 1, updatedAt: 1 });
    await addFile('col1', 'doc.txt', 'text/plain', 40, 'the quick brown fox');

    const chatBodies: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/chat')) {
        chatBodies.push(String(init?.body ?? ''));
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"Reply text"}}\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            }),
          },
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as unknown as Response;
    });

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;

    // Create a pending chip, then send ordinary prose (not a command).
    fireEvent.change(composer, { target: { value: '#' } });
    await waitFor(() => expect(screen.getByText('doc.txt')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByText('doc.txt'));
    await waitFor(() => expect(screen.getByText('#context 1')).toBeInTheDocument());

    fireEvent.change(composer, { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // The prose must still carry the chip's "Reference context:" block up to
    // the model, proving the guard only suppresses prepend for commands.
    await waitFor(() => expect(chatBodies.length).toBe(1));
    expect(chatBodies[0]).toContain('Reference context');
    expect(chatBodies[0]).toContain('Hello there');
  });
});
