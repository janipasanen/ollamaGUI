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

describe('Keyboard shortcuts overlay completeness (#266)', () => {
  it('lists regenerate, focus-composer, send, newline and stop bindings', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    render(<App />);
    fireEvent.keyDown(window, { key: '?' });

    const heading = await screen.findByRole('heading', { name: 'Keyboard Shortcuts' });
    expect(heading).toBeInTheDocument();

    const overlay = heading.closest('div.rounded-2xl')!;
    const text = overlay.textContent ?? '';
    expect(text).toContain('Regenerate Last Reply');
    expect(text).toContain('Ctrl+R');
    expect(text).toContain('Focus Composer');
    expect(text).toContain('Ctrl+L');
    expect(text).toContain('Send Message');
    expect(text).toContain('Enter');
    expect(text).toContain('New Line in Composer');
    expect(text).toContain('Shift+Enter');
    expect(text).toContain('Stop Generation / Close');
    expect(text).toContain('Escape');
  });

  it('still lists the original bindings', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    render(<App />);
    fireEvent.keyDown(window, { key: '?' });
    const heading = await screen.findByRole('heading', { name: 'Keyboard Shortcuts' });
    const text = (heading.closest('div.rounded-2xl')!.textContent ?? '');
    expect(text).toContain('New Chat');
    expect(text).toContain('Command Palette');
    expect(text).toContain('Find in Chat');
    expect(text).toContain('Toggle Terminal');
    expect(text).toContain('Open Settings');
  });
});
