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

describe('/search slash command (#276)', () => {
  it('pre-fills and focuses the sidebar search with a query', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(composer, { target: { value: '/search cats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    const sidebarSearch = await screen.findByLabelText('Search conversations') as HTMLInputElement;
    expect(sidebarSearch.value).toBe('cats');
    await waitFor(() => expect(document.activeElement).toBe(sidebarSearch));
  });

  it('focuses the sidebar search with no argument', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...');
    fireEvent.change(composer, { target: { value: '/search' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    const sidebarSearch = await screen.findByLabelText('Search conversations') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(sidebarSearch));
  });
});
