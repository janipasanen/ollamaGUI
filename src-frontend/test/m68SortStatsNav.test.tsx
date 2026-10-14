/**
 * M68: Conversation-list ordering (#327 — the sort selector UI was removed in
 *      the project-first sidebar rewrite; the list still defaults to
 *      newest-first), /stats command (#328), keyboard arrow navigation in
 *      conversation list (#329).
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

const seedSessions = [
  { id: 'z1', title: 'Zebra chat', messages: [{ role: 'user', content: 'one' }], model: 'llama3', createdAt: 1000 },
  { id: 'a1', title: 'Apple chat', messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'user', content: 'c' }], model: 'llama3', createdAt: 3000 },
  { id: 'm1', title: 'Mango chat', messages: [{ role: 'user', content: 'x' }, { role: 'user', content: 'y' }], model: 'llama3', createdAt: 2000 },
];

// ── #327 Conversation-list ordering ──────────────────────────────────────────
// The Recent/Name/Messages sort buttons were removed with the project-first
// sidebar rewrite. The list still defaults to newest-first; assert that and
// that the old sort chrome is gone.

describe('Conversation-list ordering (#327, sort selector removed)', () => {
  it('orders sessions newest first by default and renders no sort buttons', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(seedSessions));
    render(<App />);
    await waitFor(() => expect(screen.getByText('Zebra chat')).toBeInTheDocument(), { timeout: 3000 });
    const rows = screen.getAllByRole('button', { name: /Load session:/i });
    expect(rows.map(r => r.getAttribute('aria-label'))).toEqual([
      'Load session: Apple chat',
      'Load session: Mango chat',
      'Load session: Zebra chat',
    ]);
    expect(screen.queryByLabelText('Sort by recent')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sort by name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sort by messages')).not.toBeInTheDocument();
  });
});

// ── #328 /stats command ──────────────────────────────────────────────────────

describe('/stats slash command (#328)', () => {
  it('shows conversation statistics in the status banner after loading a session', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify([
      { id: 's1', title: 'Stats chat', messages: [
        { role: 'user', content: 'hello world' },
        { role: 'assistant', content: 'hi there friend' },
      ], model: 'llama3', createdAt: 1000 },
    ]));
    render(<App />);
    await waitFor(() => expect(screen.getByText('Stats chat')).toBeInTheDocument(), { timeout: 3000 });
    // Load the session
    fireEvent.click(screen.getByRole('button', { name: 'Load session: Stats chat' }));
    // Run /stats
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/stats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    const banner = await screen.findByText(/Messages: 2/);
    expect(banner.textContent).toContain('User/Assistant: 1/1');
    expect(banner.textContent).toContain('Words:');
    expect(banner.textContent).toContain('Characters:');
    expect(banner.textContent).toContain('Est. tokens:');
  });

  it('reports empty stats when there are no messages', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(seedSessions));
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('Message Ollama...')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/stats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    const banner = await screen.findByText(/Messages: 0/);
    expect(banner.textContent).toContain('User/Assistant: 0/0');
  });
});

// ── #329 Arrow-key navigation in conversation list ───────────────────────────

describe('Keyboard arrow navigation in conversation list (#329)', () => {
  it('ArrowDown moves focus to the next session row', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(seedSessions));
    render(<App />);
    const rows = await waitFor(() => screen.getAllByRole('button', { name: /Load session:/i }), { timeout: 3000 });
    rows[0].focus();
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
  });

  it('ArrowUp moves focus to the previous session row', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(seedSessions));
    render(<App />);
    const rows = await waitFor(() => screen.getAllByRole('button', { name: /Load session:/i }), { timeout: 3000 });
    rows[2].focus();
    fireEvent.keyDown(rows[2], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[1]);
  });

  it('ArrowDown does not move past the last row', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(seedSessions));
    render(<App />);
    const rows = await waitFor(() => screen.getAllByRole('button', { name: /Load session:/i }), { timeout: 3000 });
    rows[2].focus();
    fireEvent.keyDown(rows[2], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[2]);
  });

  it('Enter loads the focused session', async () => {
    localStorage.setItem('ollama_gui_sessions', JSON.stringify(seedSessions));
    render(<App />);
    const rows = await waitFor(() => screen.getAllByRole('button', { name: /Load session:/i }), { timeout: 3000 });
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: 'Enter' });
    // After loading, the session title appears in the header area / messages render
    await waitFor(() => {
      expect(screen.getAllByText('Apple chat').length).toBeGreaterThan(0);
    });
  });
});
