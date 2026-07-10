import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { loadAutoCommitEdits } from '../services/autoCommit';

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

describe('Auto-commit edits setting (#401)', () => {
  it('renders a toggle that persists the setting when flipped on', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    expect(loadAutoCommitEdits()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));
    const sw = screen.getByRole('switch', { name: 'Auto-commit edits' });
    expect(sw).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(sw);
    expect(screen.getByRole('switch', { name: 'Auto-commit edits' })).toHaveAttribute('aria-checked', 'true');
    expect(loadAutoCommitEdits()).toBe(true);
  });
});
