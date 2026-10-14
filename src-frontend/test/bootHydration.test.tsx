// Boot hydration: when localStorage lost the stores (WebView eviction, user
// clear) but the Rust disk mirror still has them, App restores localStorage
// from disk in loadInitialData BEFORE the first storage read.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { loadMock, mirrorMock } = vi.hoisted(() => ({
  loadMock: vi.fn(),
  mirrorMock: vi.fn(),
}));
vi.mock('../services/rustStore', () => ({
  loadFromDisk: loadMock,
  mirrorToDisk: mirrorMock,
  hasTauri: () => true, // simulate the Tauri runtime so hydration runs
  _clearPendingMirrors: vi.fn(),
}));

import App from '../App';

const diskSessions = JSON.stringify([
  { id: 'disk-1', title: 'Recovered chat', messages: [], createdAt: 10, model: 'llama3' },
]);

describe('boot hydration from the disk mirror', () => {
  beforeEach(() => {
    localStorage.clear();
    loadMock.mockReset();
    mirrorMock.mockClear();
  });

  it('restores sessions from disk when localStorage is empty and lists them', async () => {
    loadMock.mockImplementation(async (key: string) =>
      key === 'sessions' ? diskSessions : null,
    );

    render(<App />);

    // The recovered session shows up in the sidebar…
    expect(
      await screen.findByRole('button', { name: /Load session: Recovered chat/i }),
    ).toBeInTheDocument();
    // …because hydration wrote it back into localStorage.
    expect(localStorage.getItem('ollama_gui_sessions')).toBe(diskSessions);
    // All three stores were probed.
    const probed = loadMock.mock.calls.map(c => c[0]).sort();
    expect(probed).toEqual(['folders', 'projects', 'sessions']);
  });

  it('leaves existing localStorage data alone (disk never wins over live data)', async () => {
    const live = JSON.stringify([
      { id: 'live-1', title: 'Live chat', messages: [], createdAt: 20, model: 'llama3' },
    ]);
    localStorage.setItem('ollama_gui_sessions', live);
    loadMock.mockResolvedValue(diskSessions);

    render(<App />);

    expect(
      await screen.findByRole('button', { name: /Load session: Live chat/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Load session: Recovered chat/i })).toBeNull();
    expect(localStorage.getItem('ollama_gui_sessions')).toBe(live);
    // sessions was NOT probed on disk; the empty folders/projects stores were.
    expect(loadMock.mock.calls.map(c => c[0])).not.toContain('sessions');
  });

  it('boots normally when the disk mirror is empty too', async () => {
    loadMock.mockResolvedValue(null);
    render(<App />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    // Fresh-install welcome state, no crash.
    expect(await screen.findByText(/What can I help you with today\?/i)).toBeInTheDocument();
  });
});
