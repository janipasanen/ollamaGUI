import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BrowserToolResult, { isBrowserToolName } from '../components/BrowserToolResult';

// ── isBrowserToolName ──────────────────────────────────────────────────────────

describe('isBrowserToolName (#75)', () => {
  it('returns true for browser_* tool names', () => {
    expect(isBrowserToolName('browser_click')).toBe(true);
    expect(isBrowserToolName('browser_screenshot')).toBe(true);
    expect(isBrowserToolName('browser_')).toBe(true);
  });

  it('returns false for non-browser tool names', () => {
    expect(isBrowserToolName('run_shell_command')).toBe(false);
    expect(isBrowserToolName('document_read')).toBe(false);
    expect(isBrowserToolName('')).toBe(false);
  });
});

// ── browser_screenshot ─────────────────────────────────────────────────────────

describe('BrowserToolResult — browser_screenshot (#75)', () => {
  it('renders an <img> with a data:image/png;base64 src from a bare base64 string', () => {
    render(
      <BrowserToolResult name="browser_screenshot" payload="iVBORw0KGgoAAAANS" dark={false} />,
    );
    const img = screen.getByAltText('screenshot') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(img.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgoAAAANS');
  });

  it('uses an existing data: URI verbatim (no double prefix)', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    render(<BrowserToolResult name="browser_screenshot" payload={dataUrl} dark={true} />);
    const img = screen.getByAltText('screenshot') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(dataUrl);
  });

  it('accepts an object payload carrying { image }', () => {
    render(
      <BrowserToolResult
        name="browser_screenshot"
        payload={{ image: 'AAAABBBB' }}
        dark={false}
      />,
    );
    const img = screen.getByAltText('screenshot') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAABBBB');
  });
});

// ── browser_snapshot ───────────────────────────────────────────────────────────

describe('BrowserToolResult — browser_snapshot (#75)', () => {
  const outline =
    'button "Submit" [ref=e1]\n' +
    'link "Home" [ref=e2]\n' +
    'textbox "Search" [ref=e3]';

  it('renders a collapsible <details> region', () => {
    const { container } = render(
      <BrowserToolResult name="browser_snapshot" payload={outline} dark={false} />,
    );
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    // Outline body is present in a <pre>.
    expect(container.querySelector('pre')?.textContent).toContain('[ref=e1]');
  });

  it('counts the refs in the summary label', () => {
    render(<BrowserToolResult name="browser_snapshot" payload={outline} dark={false} />);
    expect(screen.getByText('Show snapshot (3 refs)')).toBeInTheDocument();
  });

  it('reports 0 refs for an outline with none', () => {
    render(
      <BrowserToolResult name="browser_snapshot" payload="generic page (no refs)" dark={false} />,
    );
    expect(screen.getByText('Show snapshot (0 refs)')).toBeInTheDocument();
  });
});

// ── browser_read_console ────────────────────────────────────────────────────────

describe('BrowserToolResult — browser_read_console (#75)', () => {
  it('renders a <li> per console entry', () => {
    const entries = [
      { type: 'log', text: 'hello' },
      { type: 'error', text: 'boom' },
      { type: 'warn', text: 'careful' },
    ];
    const { container } = render(
      <BrowserToolResult name="browser_read_console" payload={entries} dark={true} />,
    );
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByText('careful')).toBeInTheDocument();
  });

  it('handles plain-string entries', () => {
    const { container } = render(
      <BrowserToolResult
        name="browser_read_console"
        payload={['just a string line']}
        dark={false}
      />,
    );
    expect(container.querySelectorAll('li').length).toBe(1);
    expect(screen.getByText('just a string line')).toBeInTheDocument();
  });
});

// ── browser_assert ──────────────────────────────────────────────────────────────

describe('BrowserToolResult — browser_assert (#75)', () => {
  it('renders a pass chip with expected/actual', () => {
    render(
      <BrowserToolResult
        name="browser_assert"
        payload={{ pass: true, expected: 'Welcome', actual: 'Welcome' }}
        dark={false}
      />,
    );
    expect(screen.getByTestId('browser-assert-pass')).toBeInTheDocument();
    expect(screen.queryByTestId('browser-assert-fail')).toBeNull();
    expect(screen.getByText(/expected:/)).toBeInTheDocument();
    expect(screen.getByText(/actual:/)).toBeInTheDocument();
  });

  it('renders a fail chip when pass is false', () => {
    render(
      <BrowserToolResult
        name="browser_assert"
        payload={{ pass: false, expected: 'Welcome', actual: 'Goodbye' }}
        dark={true}
      />,
    );
    expect(screen.getByTestId('browser-assert-fail')).toBeInTheDocument();
    expect(screen.queryByTestId('browser-assert-pass')).toBeNull();
  });
});

// ── default / unknown ───────────────────────────────────────────────────────────

describe('BrowserToolResult — unknown name (#75)', () => {
  it('falls back to a JSON <pre> for non-rich names', () => {
    const { container } = render(
      <BrowserToolResult name="browser_click" payload={{ ok: true, x: 1 }} dark={false} />,
    );
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('"ok": true');
  });
});
