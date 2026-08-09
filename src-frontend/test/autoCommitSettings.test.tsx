import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { loadAutoCommitEdits, saveAutoCommitEdits } from '../services/autoCommit';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
});

describe('Auto-commit edits setting (#401, default-on contract)', () => {
  it('defaults to enabled without any Settings toggle (toggle removed)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    // Auto-commit is on by default — it is the undo mechanism for autonomous edits.
    expect(loadAutoCommitEdits()).toBe(true);

    // The Settings toggle was removed; the switch must no longer render.
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    expect(screen.queryByRole('switch', { name: 'Auto-commit edits' })).not.toBeInTheDocument();
  });

  it('an explicit stored false still disables auto-commit', () => {
    saveAutoCommitEdits(false);
    expect(loadAutoCommitEdits()).toBe(false);
  });
});
