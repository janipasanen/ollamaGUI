import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CodeSearchPanel, { registerCodeSearchPanel } from '../components/CodeSearchPanel';
import { _mocks as fsMocks } from '../services/fileTools';
import { panelRegistry } from '../components/PanelShell';

beforeEach(() => { fsMocks.invoke = null; });
afterEach(() => { fsMocks.invoke = null; });

describe('CodeSearchPanel (#431)', () => {
  it('runs a search and renders results grouped by file', async () => {
    fsMocks.invoke = async (cmd) => {
      if (cmd === 'search_files') {
        return [
          { file: 'src/a.ts', line: 3, text: 'const x = 1' },
          { file: 'src/a.ts', line: 9, text: 'return x' },
          { file: 'src/b.ts', line: 1, text: 'import x' },
        ];
      }
      throw new Error('unexpected ' + cmd);
    };
    render(<CodeSearchPanel dark={false} />);
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText(/src\/a\.ts/)).toBeInTheDocument());
    expect(screen.getByText('const x = 1')).toBeInTheDocument();
    expect(screen.getByText(/src\/b\.ts/)).toBeInTheDocument();
  });

  it('clicking a hit dispatches ollama-gui:select-file', async () => {
    fsMocks.invoke = async () => [{ file: 'src/a.ts', line: 3, text: 'const x = 1' }];
    const spy = vi.fn();
    window.addEventListener('ollama-gui:select-file', spy);
    render(<CodeSearchPanel dark={false} />);
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('const x = 1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('const x = 1'));
    expect(spy).toHaveBeenCalled();
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.entry.path).toBe('src/a.ts');
    window.removeEventListener('ollama-gui:select-file', spy);
  });

  it('passes the regex flag and glob filter', async () => {
    let captured: any = null;
    fsMocks.invoke = async (_cmd, args) => { captured = args; return []; };
    render(<CodeSearchPanel dark={false} />);
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'foo.*bar' } });
    fireEvent.click(screen.getByLabelText('Use regex'));
    fireEvent.change(screen.getByLabelText('File glob filter'), { target: { value: 'src/**/*.ts' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured.isRegex).toBe(true);
    expect(captured.includeGlob).toBe('src/**/*.ts');
  });

  it('registers into the panel registry', () => {
    registerCodeSearchPanel();
    const ids = panelRegistry.list().map((p: any) => p.id);
    expect(ids).toContain('code-search');
  });
});
