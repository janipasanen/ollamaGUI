import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;
let origCreateObjectURL: typeof URL.createObjectURL;

beforeEach(() => {
  origFetch = global.fetch;
  origCreateObjectURL = URL.createObjectURL;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
});

afterEach(() => {
  global.fetch = origFetch;
  URL.createObjectURL = origCreateObjectURL;
  localStorage.clear();
});

describe('Per-conversation Markdown export (#256)', () => {
  it('clicking Export as Markdown produces a .md blob with the conversation', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/api/chat')) {
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"Hello there"}}\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            }),
          },
        } as any;
      }
      return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
    });

    const captured: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      captured.push(blob);
      return 'blob:mock';
    }) as any;

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => screen.getByText('Hello there'), { timeout: 3000 });

    const exportBtn = screen.getByRole('button', { name: 'Export conversation as Markdown' });
    fireEvent.click(exportBtn);

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const mdBlob = captured[captured.length - 1];
    expect(mdBlob.type).toBe('text/markdown');
    const text = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsText(mdBlob);
    });
    expect(text).toContain('## User');
    expect(text).toContain('Hi');
    expect(text).toContain('## Assistant');
    expect(text).toContain('Hello there');
  });

  it('the export button is disabled when there are no messages', () => {
    render(<App />);
    const exportBtn = screen.getByRole('button', { name: 'Export conversation as Markdown' });
    expect(exportBtn).toBeDisabled();
  });
});
