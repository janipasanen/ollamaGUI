/**
 * M72: Starred models (#339) and per-message copy-as-plain-text (#341).
 *
 * Post-rewrite: the header star-model button is gone (no starring UI remains),
 * but the "★ Starred" optgroup in the model selector still reflects
 * localStorage. Copy-as-plain-text lost its hover button and now lives in the
 * message right-click context menu. The per-message token badge (#340) was
 * removed along with the per-message header row — no replacement surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { seedLocalOllama } from './helpers/providers';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
    // #566: nothing is pre-configured now, so this spec adds the provider.
    seedLocalOllama();
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

// ── #339 Starred models still surface in the selector ───────────────────────

describe('Starred models in the model selector (#339)', () => {
  it('shows a Starred optgroup with the models starred in localStorage', async () => {
    localStorage.setItem('ollama_gui_starred_models', JSON.stringify(['llama3']));
    global.fetch = modelsFetch(['llama3', 'mistral']);
    render(<App />);
    const select = await screen.findByLabelText('Select AI model') as HTMLSelectElement;
    await waitFor(() => {
      const starredGroup = Array.from(select.querySelectorAll('optgroup')).find(g => g.label.includes('Starred'));
      expect(starredGroup).toBeTruthy();
      expect(starredGroup!.textContent).toContain('llama3');
      // Only starred models belong in the group.
      expect(starredGroup!.textContent).not.toContain('mistral');
    }, { timeout: 3000 });
  });

  it('renders no Starred optgroup when nothing is starred', async () => {
    global.fetch = modelsFetch(['llama3']);
    render(<App />);
    const select = await screen.findByLabelText('Select AI model') as HTMLSelectElement;
    await waitFor(() => {
      // Models loaded (llama3 option present)…
      expect(Array.from(select.querySelectorAll('option')).some(o => o.value === 'llama3')).toBe(true);
    }, { timeout: 3000 });
    // …but no Starred group appears.
    const starredGroup = Array.from(select.querySelectorAll('optgroup')).find(g => g.label.includes('Starred'));
    expect(starredGroup).toBeFalsy();
  });

  it('ignores starred entries that are not installed models', async () => {
    localStorage.setItem('ollama_gui_starred_models', JSON.stringify(['gone-model']));
    global.fetch = modelsFetch(['llama3']);
    render(<App />);
    const select = await screen.findByLabelText('Select AI model') as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.querySelectorAll('option')).some(o => o.value === 'llama3')).toBe(true);
    }, { timeout: 3000 });
    // No stale "gone-model" option is offered anywhere in the select.
    expect(Array.from(select.querySelectorAll('option')).some(o => o.value === 'gone-model')).toBe(false);
  });
});

// ── #341 Copy-as-plain-text via the message context menu ────────────────────

describe('Copy as plain text via the message context menu (#341)', () => {
  it('copies an assistant message as plain text (markdown stripped)', async () => {
    global.fetch = modelsFetch(['llama3']);
    await loadSession('s1', 'Plain chat', [
      { role: 'user', content: 'show me bold' },
      { role: 'assistant', content: 'Here is **bold** text' },
    ]);
    // Right-click the assistant message — the contextmenu event bubbles up to
    // the message wrapper carrying the onContextMenu handler.
    const bold = await screen.findByText('bold', {}, { timeout: 3000 });
    fireEvent.contextMenu(bold, { clientX: 100, clientY: 100 });

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy as plain text' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    const copied = (navigator.clipboard.writeText as any).mock.calls.at(-1)[0] as string;
    expect(copied).toContain('Assistant:');
    expect(copied).toContain('Here is bold text');
    expect(copied).not.toContain('**');
  });

  it('does not offer plain-text copy on user messages', async () => {
    global.fetch = modelsFetch(['llama3']);
    await loadSession('s2', 'User ctx chat', [
      { role: 'user', content: 'Hi there question' },
      { role: 'assistant', content: 'Hello there' },
    ]);
    fireEvent.contextMenu(await screen.findByText('Hi there question', {}, { timeout: 3000 }), { clientX: 10, clientY: 10 });
    // The generic copy is offered…
    expect(await screen.findByRole('menuitem', { name: 'Copy message' })).toBeInTheDocument();
    // …but the assistant-only plain-text variant is not.
    expect(screen.queryByRole('menuitem', { name: 'Copy as plain text' })).not.toBeInTheDocument();
  });
});
