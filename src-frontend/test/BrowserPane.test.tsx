import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// PanelShell is owned by a sibling worker and may not exist standalone, so we
// mock it here. This keeps the BrowserPane test self-contained (no shared-file
// integration) while still exercising the registration call.
const registerSpy = vi.fn();
const unregisterSpy = vi.fn();
vi.mock('../components/PanelShell', () => ({
  panelRegistry: {
    register: (...args: any[]) => registerSpy(...args),
    unregister: (...args: any[]) => unregisterSpy(...args),
  },
}));

import BrowserPane, { _mocks } from '../components/BrowserPane';
import { browserBus, browserSession } from '../services/browser';

// Provide a ResizeObserver in jsdom (it isn't implemented there) so the
// component's observer wiring runs without throwing.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  (globalThis as any).ResizeObserver = FakeResizeObserver as any;
  _mocks.invoke = null;
  registerSpy.mockClear();
  unregisterSpy.mockClear();
  // Reset shared session url so cross-test ordering can't leak an external url.
  browserSession.navUrl = '';
});

afterEach(() => {
  cleanup();
  _mocks.invoke = null;
});

/** Type a url into the address bar and submit the form (clicks Go). */
function navigateTo(url: string) {
  fireEvent.change(screen.getByLabelText('Address bar'), { target: { value: url } });
  fireEvent.click(screen.getByLabelText('Go'));
}

describe('BrowserPane (#71, #72)', () => {
  it('registers itself with panelRegistry (id "browser") on mount', () => {
    render(<BrowserPane dark={false} />);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0][0]).toMatchObject({ id: 'browser' });
  });

  it('renders an iframe for a localhost url', () => {
    render(<BrowserPane dark={false} />);
    navigateTo('http://localhost:5173');
    const iframe = screen.getByTestId('browser-iframe');
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe).toHaveAttribute('src', 'http://localhost:5173');
    // No native host placeholder in iframe mode.
    expect(screen.queryByTestId('browser-webview-host')).toBeNull();
  });

  it('renders the #browser-webview-host div for an external url', () => {
    render(<BrowserPane dark={false} />);
    navigateTo('https://example.com');
    const host = screen.getByTestId('browser-webview-host');
    expect(host).toBeInTheDocument();
    expect(host.id).toBe('browser-webview-host');
    // No iframe in external mode.
    expect(screen.queryByTestId('browser-iframe')).toBeNull();
  });

  it('shows the browser-mode note in the placeholder when no Tauri runtime', () => {
    render(<BrowserPane dark={false} />);
    navigateTo('https://example.com');
    expect(screen.getByText('native preview unavailable in browser mode')).toBeInTheDocument();
  });

  it('submitting the address-bar form emits browserBus "navigate" with the typed url', () => {
    const emitSpy = vi.spyOn(browserBus, 'emit');
    render(<BrowserPane dark={false} />);
    navigateTo('http://localhost:3000');
    expect(emitSpy).toHaveBeenCalledWith('navigate', 'http://localhost:3000');
    emitSpy.mockRestore();
  });

  it('clicking Reload bumps the iframe key (forces a remount)', () => {
    render(<BrowserPane dark={false} />);
    navigateTo('http://localhost:5173');
    const before = screen.getByTestId('browser-iframe').getAttribute('data-iframe-key');
    fireEvent.click(screen.getByLabelText('Reload'));
    const after = screen.getByTestId('browser-iframe').getAttribute('data-iframe-key');
    expect(before).not.toBe(after);
  });

  it('auto-reload bumps the iframe key on a "loaded" bus event', () => {
    render(<BrowserPane dark={false} />);
    navigateTo('http://localhost:5173');
    // Enable auto-reload.
    fireEvent.click(screen.getByLabelText('Auto-reload'));
    const before = screen.getByTestId('browser-iframe').getAttribute('data-iframe-key');
    act(() => {
      browserBus.emit('loaded', 'http://localhost:5173');
    });
    const after = screen.getByTestId('browser-iframe').getAttribute('data-iframe-key');
    expect(before).not.toBe(after);
  });

  it('switching to an external url calls preview_webview_open with a rect (mocked invoke)', () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    _mocks.invoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return undefined;
    });
    render(<BrowserPane dark={false} />);
    navigateTo('https://example.com');

    const open = calls.find((c) => c.cmd === 'preview_webview_open');
    expect(open).toBeDefined();
    expect(open!.args).toMatchObject({ url: 'https://example.com' });
    // A geometry rect must be supplied so the native webview can be placed.
    const rect = open!.args.rect as Record<string, number>;
    expect(rect).toBeDefined();
    expect(typeof rect.x).toBe('number');
    expect(typeof rect.y).toBe('number');
    expect(typeof rect.width).toBe('number');
    expect(typeof rect.height).toBe('number');
  });

  it('a window resize calls preview_webview_set_bounds with a rect (external mode)', () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    _mocks.invoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return undefined;
    });
    render(<BrowserPane dark={false} />);
    navigateTo('https://example.com');
    // The session url drives the external-mode guard inside syncBounds.
    browserSession.navUrl = 'https://example.com';

    // Simulate a layout change.
    window.dispatchEvent(new Event('resize'));

    const bounds = calls.find((c) => c.cmd === 'preview_webview_set_bounds');
    expect(bounds).toBeDefined();
    const rect = bounds!.args.rect as Record<string, number>;
    expect(rect).toBeDefined();
    expect(typeof rect.width).toBe('number');
    expect(typeof rect.height).toBe('number');
  });

  it('reload in external mode calls preview_webview_reload (mocked invoke)', () => {
    const calls: string[] = [];
    _mocks.invoke = vi.fn(async (cmd: string) => {
      calls.push(cmd);
      return undefined;
    });
    render(<BrowserPane dark={false} />);
    navigateTo('https://example.com');
    browserSession.navUrl = 'https://example.com';
    fireEvent.click(screen.getByLabelText('Reload'));
    expect(calls).toContain('preview_webview_reload');
  });

  it('renders in dark mode without crashing', () => {
    render(<BrowserPane dark={true} />);
    expect(screen.getByTestId('browser-pane')).toBeInTheDocument();
  });
});
