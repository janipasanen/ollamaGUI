import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { DiffReviewModal } from '../components/DiffReviewModal';
import type { PendingEdit } from '../services/diffReview';
import { storage, type ChatSession } from '../services/storage';
import { savePinnedFiles } from '../services/pinnedFiles';
import { _mocks as fileMocks } from '../services/fileTools';
import { _mocks as webSearchMocks } from '../services/websearch';

let origFetch: typeof global.fetch;

function chatStreamResponse(content: string) {
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: Buffer.from(`{"message":{"content":${JSON.stringify(content)}}}\n`) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }),
    },
  } as any;
}

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/api/chat')) return chatStreamResponse('done');
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
  fileMocks.invoke = async (cmd: string) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd === 'read_file') return 'file content here';
    return undefined;
  };
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  fileMocks.invoke = null;
  webSearchMocks.webSearch = null;
});

// ── #369: Clear-all pinned files button ───────────────────────────────────────

describe('Clear-all pinned files button (#369)', () => {
  it('appears when 2+ files are pinned and clears all on click', async () => {
    // Seed two pinned files in localStorage
    savePinnedFiles([
      { path: 'src/a.ts', label: 'a.ts', content: 'aaa' },
      { path: 'src/b.ts', label: 'b.ts', content: 'bbb' },
    ]);

    render(<App />);
    await waitFor(() => {
      expect(screen.getByLabelText('Drop pinned file src/a.ts')).toBeInTheDocument();
      expect(screen.getByLabelText('Drop pinned file src/b.ts')).toBeInTheDocument();
    });

    const clearBtn = screen.getByLabelText('Clear all pinned files');
    expect(clearBtn).toBeInTheDocument();

    fireEvent.mouseDown(clearBtn);

    await waitFor(() => {
      expect(screen.queryByLabelText('Drop pinned file src/a.ts')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Drop pinned file src/b.ts')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Cleared all pinned files/);
  });

  it('does not appear with only one pinned file', async () => {
    savePinnedFiles([
      { path: 'src/a.ts', label: 'a.ts', content: 'aaa' },
    ]);

    render(<App />);
    await waitFor(() => {
      expect(screen.getByLabelText('Drop pinned file src/a.ts')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Clear all pinned files')).not.toBeInTheDocument();
  });
});

// ── #370: Copy-diff button in DiffReviewModal ─────────────────────────────────

describe('Copy-diff button in DiffReviewModal (#370)', () => {
  const edit: PendingEdit = {
    id: 'e1', path: 'src/app.ts', kind: 'apply_edit',
    oldString: 'a\nb\nc', newString: 'a\nB\nc', createdAt: 1,
  };

  it('copies a unified diff to the clipboard', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true });

    render(<DiffReviewModal edit={edit} dark={false} onResolve={() => {}} />);
    const copyBtn = screen.getByLabelText('Copy diff to clipboard');
    fireEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('--- a/src/app.ts');
    expect(copied).toContain('+++ b/src/app.ts');
    expect(copied).toContain('-b');
    expect(copied).toContain('+B');
  });

  it('shows "Copied" feedback after clicking', () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn() }, writable: true, configurable: true });

    render(<DiffReviewModal edit={edit} dark={true} onResolve={() => {}} />);
    const copyBtn = screen.getByLabelText('Copy diff to clipboard');
    expect(copyBtn.textContent).toContain('Copy diff');
    fireEvent.click(copyBtn);
    expect(copyBtn.textContent).toContain('Copied');
  });
});

// ── #371: /web slash command ──────────────────────────────────────────────────

describe('/web slash command (#371)', () => {
  it('searches the web and feeds results to the model', async () => {
    webSearchMocks.webSearch = vi.fn(async () => [
      { title: 'Result 1', url: 'https://example.com/1', snippet: 'Snippet 1' },
      { title: 'Result 2', url: 'https://example.com/2', snippet: 'Snippet 2' },
    ]);

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/web latest LLM news' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Found 2 results/);
    }, { timeout: 5000 });
  });

  it('refuses with no query', async () => {
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/web' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Usage: \/web/));
  });

  it('reports when no results are found', async () => {
    webSearchMocks.webSearch = vi.fn(async () => []);

    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/web obscure query' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/No web search results/);
    }, { timeout: 5000 });
  });
});
