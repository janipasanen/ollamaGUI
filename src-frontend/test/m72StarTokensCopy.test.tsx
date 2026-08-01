/**
 * M72: Model starring (#339), per-message token badge (#340),
 *      per-message copy-as-plain-text (#341).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  vi.restoreAllMocks();
});

const modelsFetch = (names: string[]) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: names.map(n => ({ name: n })) }), body: null, text: async () => '' } as any);

const loadSession = async (id: string, title: string, messages: any[]) => {
  localStorage.setItem('ollama_gui_sessions', JSON.stringify([
    { id, title, messages, model: 'llama3', createdAt: 1000 },
  ]));
  render(<App />);
  await waitFor(() => {
    const btns = screen.getAllByRole('button', { name: new RegExp(`Load session: ${title}`) });
    expect(btns.length).toBeGreaterThan(0);
  }, { timeout: 3000 });
  fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`Load session: ${title}`) })[0]);
};

// ── #339 Model starring ──────────────────────────────────────────────────────

describe('Model starring (#339)', () => {
  it('stars the current model and persists to localStorage', async () => {
    global.fetch = modelsFetch(['llama3']);
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Select AI model')).toBeInTheDocument(), { timeout: 3000 });
    const starBtn = screen.getByLabelText('Star model');
    fireEvent.click(starBtn);
    await waitFor(() => expect(screen.getByLabelText('Unstar model')).toHaveAttribute('aria-pressed', 'true'));
    expect(JSON.parse(localStorage.getItem('ollama_gui_starred_models') ?? '[]')).toContain('llama3');
  });

  it('shows a Starred optgroup after starring a model', async () => {
    global.fetch = modelsFetch(['llama3']);
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Star model')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByLabelText('Star model'));
    await waitFor(() => expect(screen.getByLabelText('Unstar model')).toBeInTheDocument());
    // The select should now contain a Starred optgroup with the llama3 option
    const select = screen.getByLabelText('Select AI model') as HTMLSelectElement;
    const starredGroup = Array.from(select.querySelectorAll('optgroup')).find(g => g.label.includes('Starred'));
    expect(starredGroup).toBeTruthy();
    expect(starredGroup!.textContent).toContain('llama3');
  });

  it('unstars the model on a second click', async () => {
    global.fetch = modelsFetch(['llama3']);
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Star model')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByLabelText('Star model'));
    await waitFor(() => expect(screen.getByLabelText('Unstar model')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Unstar model'));
    await waitFor(() => expect(screen.getByLabelText('Star model')).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem('ollama_gui_starred_models') ?? '[]')).not.toContain('llama3');
  });

  it('restores starred models from localStorage on load', async () => {
    localStorage.setItem('ollama_gui_starred_models', JSON.stringify(['llama3']));
    global.fetch = modelsFetch(['llama3']);
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Unstar model')).toHaveAttribute('aria-pressed', 'true'), { timeout: 3000 });
  });
});

// ── #340 Per-message token badge ─────────────────────────────────────────────

describe('Per-message estimated token badge (#340)', () => {
  it('renders an estimated-token badge on each message', async () => {
    global.fetch = modelsFetch(['llama3']);
    await loadSession('s1', 'Token chat', [
      { role: 'user', content: 'Hello world this is a test message' },
      { role: 'assistant', content: 'Hi there, how can I help?' },
    ]);
    const badges = await screen.findAllByLabelText(/Estimated tokens:/i, {}, { timeout: 3000 });
    expect(badges.length).toBeGreaterThanOrEqual(2);
    // Spelled-out unit, not a bare "t" — next to the timestamp that read as
    // seconds (#486).
    expect(badges[0].textContent).toMatch(/≈[\d.]+k? tokens/);
  });

  it('does not render a badge for empty messages', async () => {
    global.fetch = modelsFetch(['llama3']);
    await loadSession('s2', 'Empty chat', [
      { role: 'user', content: 'Real content' },
      { role: 'assistant', content: '' },
    ]);
    const badges = screen.getAllByLabelText(/Estimated tokens:/i);
    // Only the non-empty user message should have a badge
    expect(badges.length).toBe(1);
  });
});

// ── #341 Per-message copy-as-plain-text ──────────────────────────────────────

describe('Per-message copy-as-plain-text (#341)', () => {
  it('copies an assistant message as plain text (markdown stripped)', async () => {
    global.fetch = modelsFetch(['llama3']);
    await loadSession('s1', 'Plain chat', [
      { role: 'user', content: 'show me bold' },
      { role: 'assistant', content: 'Here is **bold** text' },
    ]);
    await waitFor(() => {
      expect(screen.getAllByLabelText('Copy message as plain text').length).toBe(1);
    }, { timeout: 3000 });
    const copyBtns = screen.getAllByLabelText('Copy message as plain text');
    // Only the assistant message renders copy buttons — its plain text strips markdown.
    fireEvent.click(copyBtns[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    const copied = (navigator.clipboard.writeText as any).mock.calls.at(-1)[0] as string;
    expect(copied).toContain('Assistant:');
    expect(copied).toContain('Here is bold text');
    expect(copied).not.toContain('**');
  });

  it('shows a checkmark confirmation after copying', async () => {
    global.fetch = modelsFetch(['llama3']);
    await loadSession('s2', 'Confirm chat', [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello there' },
    ]);
    await waitFor(() => expect(screen.getByLabelText('Copy message as plain text')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByLabelText('Copy message as plain text'));
    await waitFor(() => {
      // After click, the button shows a ✓ confirmation glyph.
      const btn = screen.getByLabelText('Copy message as plain text');
      expect(btn.textContent).toBe('✓');
    });
  });
});
