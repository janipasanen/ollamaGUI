import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

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

describe('Toggle theme via Ctrl/Cmd+Shift+D (#275)', () => {
  it('toggles dark mode to light mode', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    const { container } = render(<App />);
    const root = container.querySelector('.h-screen') as HTMLElement;
    expect(root.className).toContain('bg-zinc-900'); // starts dark

    (document.activeElement as HTMLElement | null)?.blur?.();
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(root.className).toContain('bg-zinc-100'); // now light
    });
    expect(root.className).not.toContain('bg-zinc-900');
  });
});
