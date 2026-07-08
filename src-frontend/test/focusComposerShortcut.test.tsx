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

describe('Focus composer via Ctrl/Cmd+L (#265)', () => {
  it('moves focus to the chat composer when Ctrl+L is pressed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    // Wait for the initial-load autofocus to settle, then move focus elsewhere.
    await waitFor(() => expect(composer).toBeInTheDocument());
    const sidebarToggle = screen.getByRole('button', { name: 'Toggle sidebar' });
    sidebarToggle.focus();
    expect(document.activeElement).toBe(sidebarToggle);

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
    expect(document.activeElement).toBe(composer);
  });
});
