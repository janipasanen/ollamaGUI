import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MarkdownMessage } from '../App';
import App from '../App';
import { storage, type ChatSession } from '../services/storage';
import { _mocks as openerMocks } from '../services/openExternal';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, code: string) => ({ svg: `<svg class="mmd">${code}</svg>` })),
  },
}));

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ models: [] }), body: null, text: async () => '',
  } as any);
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  openerMocks.openUrl = null;
});

// ── Markdown links open in system browser (#354) ──────────────────────────────

describe('Markdown links open in the system browser (#354)', () => {
  it('calls openExternalUrl on click and prevents navigation', async () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    openerMocks.openUrl = openUrl;
    render(<MarkdownMessage dark={false} content={'[docs](https://example.com)'} />);
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    fireEvent.click(link);
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith('https://example.com'));
  });

  it('leaves non-http links as ordinary anchors', () => {
    render(<MarkdownMessage dark={false} content={'[top](#section)'} />);
    const link = screen.getByRole('link', { name: 'top' });
    fireEvent.click(link);
    expect(openerMocks.openUrl).toBeNull(); // seam never invoked
  });
});

// ── Autonomy quick-selector in the header (#355) ──────────────────────────────

describe('Autonomy quick-selector (#355)', () => {
  it('switches level and persists to localStorage', () => {
    render(<App />);
    const autoBtn = screen.getByRole('button', { name: 'Set autonomy: auto' });
    expect(autoBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(autoBtn);
    expect(autoBtn).toHaveAttribute('aria-pressed', 'true');
    const saved = JSON.parse(localStorage.getItem('ollama_gui_agent_autonomy') ?? '{}');
    expect(saved.level).toBe('auto');
  });
});

// ── Resume last conversation on startup (#356) ────────────────────────────────

describe('Resume last conversation on startup (#356)', () => {
  function seedSession(): ChatSession {
    const session: ChatSession = {
      id: 's-resume', title: 'ResumeTitle', createdAt: Date.now(), model: 'llama3',
      messages: [
        { role: 'user', content: 'firstusermsg' },
        { role: 'assistant', content: 'RESUME ME' },
      ],
    };
    storage.saveSession(session);
    return session;
  }

  it('auto-loads the most recent session when the setting is enabled', async () => {
    localStorage.setItem('ollama_gui_resume_last_session', 'true');
    seedSession();
    render(<App />);
    await waitFor(() => expect(screen.getByText('RESUME ME')).toBeInTheDocument());
  });

  it('stays blank when the setting is disabled', () => {
    seedSession();
    render(<App />);
    expect(screen.queryByText('RESUME ME')).not.toBeInTheDocument();
  });
});
