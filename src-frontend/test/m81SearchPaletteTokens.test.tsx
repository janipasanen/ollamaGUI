import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { storage, type ChatSession } from '../services/storage';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ models: [] }),
    body: null,
    text: async () => '',
  } as any);
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
});

// ── #366: Chat search term highlighting ───────────────────────────────────────

describe('Chat search term highlighting (#366)', () => {
  it('highlights matched terms with <mark> when search is active', async () => {
    const session: ChatSession = {
      id: 's1', title: 'Test', createdAt: 1, model: 'llama3',
      messages: [
        { role: 'user', content: 'Tell me about elephants' },
        { role: 'assistant', content: 'Elephants are large mammals.' },
      ],
    };
    storage.saveSession(session);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load session: Test' }));

    // Open search and type a query
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    const searchInput = screen.getByLabelText('Search query');
    fireEvent.change(searchInput, { target: { value: 'elephants' } });

    // Wait for highlights to appear
    await waitFor(() => {
      const marks = document.querySelectorAll('mark');
      expect(marks.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // Verify at least one mark contains the search term
    const markTexts = Array.from(document.querySelectorAll('mark')).map(m => m.textContent);
    expect(markTexts.some(t => t?.toLowerCase().includes('elephant'))).toBe(true);
  });

  it('removes highlights when search is closed', async () => {
    const session: ChatSession = {
      id: 's2', title: 'Test2', createdAt: 2, model: 'llama3',
      messages: [
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'World greeting received.' },
      ],
    };
    storage.saveSession(session);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load session: Test2' }));

    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'world' } });
    await waitFor(() => expect(document.querySelectorAll('mark').length).toBeGreaterThan(0));

    // Close search
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(document.querySelectorAll('mark').length).toBe(0);
    });
  });
});

// ── #367: Command palette missing actions ─────────────────────────────────────

describe('Command palette has all major actions (#367)', () => {
  it('includes Toggle Theme, Toggle Zen Mode, and Toggle Artifacts', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p', metaKey: true });
    const palette = screen.getByRole('dialog', { name: /Command palette/i });
    expect(palette).toHaveTextContent('Toggle Theme');
    expect(palette).toHaveTextContent('Toggle Zen/Focus Mode');
    expect(palette).toHaveTextContent('Toggle Artifacts Panel');
  });

  it('includes Regenerate, Copy Last Reply, and Scroll to Latest', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p', metaKey: true });
    const palette = screen.getByRole('dialog', { name: /Command palette/i });
    expect(palette).toHaveTextContent('Regenerate Last Reply');
    expect(palette).toHaveTextContent('Copy Last Reply');
    expect(palette).toHaveTextContent('Scroll to Latest');
  });

  it('includes Pin/Unpin, Next/Previous Conversation, and Zoom controls', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p', metaKey: true });
    const palette = screen.getByRole('dialog', { name: /Command palette/i });
    expect(palette).toHaveTextContent('Pin/Unpin Conversation');
    expect(palette).toHaveTextContent('Next Conversation');
    expect(palette).toHaveTextContent('Previous Conversation');
    expect(palette).toHaveTextContent('Zoom In');
    expect(palette).toHaveTextContent('Zoom Out');
    expect(palette).toHaveTextContent('Reset Zoom');
  });
});

// ── #368: Token estimate in composer footer ────────────────────────────────────

describe('Composer token estimate (#368)', () => {
  it('shows an estimated token count alongside word/char count', () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'Hello world this is a test message' } });

    const footer = screen.getByText(/words · .* chars · ~.* tokens/);
    expect(footer).toBeInTheDocument();
    expect(footer.textContent).toMatch(/~\d+ tokens/);
  });

  it('does not show the word/char/token counter when the input is empty', () => {
    render(<App />);
    expect(screen.queryByText(/words · .* chars · ~.* tokens/)).not.toBeInTheDocument();
  });
});
