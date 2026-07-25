import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// PanelShell is owned by a sibling worker and may not exist standalone, so we
// mock it here. This keeps the BrowserPane test self-contained (no shared-file
// integration) while still exercising the registration call.
const { registerSpy, unregisterSpy } = vi.hoisted(() => ({
  registerSpy: vi.fn(),
  unregisterSpy: vi.fn(),
}));
vi.mock('../components/PanelShell', () => ({
  panelRegistry: {
    register: (...args: any[]) => registerSpy(...args),
    unregister: (...args: any[]) => unregisterSpy(...args),
  },
}));

import BrowserPane from '../components/BrowserPane';
import * as previewClient from '../services/browserPreview';
import { browserBus, browserSession } from '../services/browser';
import * as chromiumClient from '../services/browserChromium';
import { waitFor } from '@testing-library/react';

// Provide a ResizeObserver in jsdom (it isn't implemented there) so the
// component's observer wiring runs without throwing.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  (globalThis as any).ResizeObserver = FakeResizeObserver as any;
  previewClient._mocks.invoke = null;
  previewClient._resetPreviewState();
  unregisterSpy.mockClear();
  // Reset shared session url so cross-test ordering can't leak an external url.
  browserSession.navUrl = '';
  // Chromium client test seams (#217).
  chromiumClient._mocks.invoke = null;
  chromiumClient._mocks.listen = null;
  delete (window as any).__TAURI_INTERNALS__;
});

afterEach(() => {
  cleanup();
  previewClient._mocks.invoke = null;
  previewClient._resetPreviewState();
  chromiumClient._mocks.invoke = null;
  chromiumClient._mocks.listen = null;
  delete (window as any).__TAURI_INTERNALS__;
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
    fireEvent.click(screen.getByLabelText('Auto-refresh preview'));
    const before = screen.getByTestId('browser-iframe').getAttribute('data-iframe-key');
    act(() => {
      browserBus.emit('loaded', 'http://localhost:5173');
    });
    const after = screen.getByTestId('browser-iframe').getAttribute('data-iframe-key');
    expect(before).not.toBe(after);
  });

  it('Back/Forward walk the navigation history (#436)', () => {
    render(<BrowserPane dark={false} />);
    const addr = () => (screen.getByLabelText('Address bar') as HTMLInputElement).value;
    navigateTo('http://localhost:5173/a');
    navigateTo('http://localhost:5173/b');
    expect(addr()).toBe('http://localhost:5173/b');
    fireEvent.click(screen.getByLabelText('Back'));
    expect(addr()).toBe('http://localhost:5173/a');
    fireEvent.click(screen.getByLabelText('Forward'));
    expect(addr()).toBe('http://localhost:5173/b');
  });

  it('switching to an external url calls preview_webview_open with a rect (mocked invoke)', () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    previewClient._mocks.invoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
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

  it('a window resize calls preview_webview_set_bounds with a rect (external mode)', async () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    previewClient._mocks.invoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return undefined;
    });
    render(<BrowserPane dark={false} />);
    await act(async () => { navigateTo('https://example.com'); });
    // The session url drives the external-mode guard inside syncBounds.
    browserSession.navUrl = 'https://example.com';
    // Allow the fire-and-forget openPreview promise chain to settle so that
    // setBoundsPreview (which now awaits _openingPromise per #450) can proceed.
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Simulate a layout change.
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    // Flush the setBoundsPreview promise chain (#450).
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const bounds = calls.find((c) => c.cmd === 'preview_webview_set_bounds');
    expect(bounds).toBeDefined();
    const rect = bounds!.args.rect as Record<string, number>;
    expect(rect).toBeDefined();
    expect(typeof rect.width).toBe('number');
    expect(typeof rect.height).toBe('number');
  });

  it('reload in external mode calls preview_webview_reload (mocked invoke)', async () => {
    const calls: string[] = [];
    previewClient._mocks.invoke = vi.fn(async (cmd: string) => {
      calls.push(cmd);
      return undefined;
    });
    render(<BrowserPane dark={false} />);
    await act(async () => { navigateTo('https://example.com'); });
    browserSession.navUrl = 'https://example.com';
    // Allow the fire-and-forget openPreview promise chain to settle (#450).
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    await act(async () => { fireEvent.click(screen.getByLabelText('Reload')); });
    // Flush the reloadPreview promise chain (#450).
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(calls).toContain('preview_webview_reload');
  });

  it('renders in dark mode without crashing', () => {
    render(<BrowserPane dark={true} />);
    expect(screen.getByTestId('browser-pane')).toBeInTheDocument();
  });

  describe('Chromium engine consent banner (#217)', () => {
    function setTauri() {
      (window as any).__TAURI_INTERNALS__ = {};
    }

    it('does not show the consent banner without a Tauri runtime', () => {
      render(<BrowserPane dark={false} />);
      expect(screen.queryByTestId('chromium-consent')).not.toBeInTheDocument();
    });

    it('shows the consent banner when no Chromium engine is found', async () => {
      setTauri();
      chromiumClient._mocks.invoke = vi.fn(async (cmd: string) => {
        if (cmd === 'browser_chromium_status') return { found: false, source: 'none' };
        return undefined;
      });
      render(<BrowserPane dark={false} />);
      await waitFor(() => expect(screen.getByTestId('chromium-consent')).toBeInTheDocument());
      expect(screen.getByLabelText('Download Chromium')).toBeInTheDocument();
      expect(screen.getByText(/No Chromium engine found/i)).toBeInTheDocument();
    });

    it('does not show the banner when a system engine is present', async () => {
      setTauri();
      chromiumClient._mocks.invoke = vi.fn(async (cmd: string) => {
        if (cmd === 'browser_chromium_status') return { found: true, source: 'system', path: '/usr/bin/chromium' };
        return undefined;
      });
      render(<BrowserPane dark={false} />);
      // No banner after the status resolves.
      await waitFor(() => {
        expect(chromiumClient._mocks.invoke).toHaveBeenCalled();
      });
      expect(screen.queryByTestId('chromium-consent')).not.toBeInTheDocument();
    });

    it('downloads Chromium and hides the banner on success', async () => {
      setTauri();
      let statusCall = 0;
      chromiumClient._mocks.invoke = vi.fn(async (cmd: string) => {
        if (cmd === 'browser_chromium_status') {
          statusCall += 1;
          return statusCall === 1
            ? { found: false, source: 'none' }
            : { found: true, source: 'downloaded', path: '/app/chrome' };
        }
        if (cmd === 'browser_chromium_download') return '/app/chrome';
        return undefined;
      });
      chromiumClient._mocks.listen = vi.fn(async () => () => {});
      render(<BrowserPane dark={false} />);
      await waitFor(() => expect(screen.getByTestId('chromium-consent')).toBeInTheDocument());
      fireEvent.click(screen.getByLabelText('Download Chromium'));
      await waitFor(() => expect(screen.queryByTestId('chromium-consent')).not.toBeInTheDocument());
      expect(chromiumClient._mocks.invoke).toHaveBeenCalledWith('browser_chromium_download', {});
    });

    it('surfaces a download error without dismissing the banner', async () => {
      setTauri();
      chromiumClient._mocks.invoke = vi.fn(async (cmd: string) => {
        if (cmd === 'browser_chromium_status') return { found: false, source: 'none' };
        if (cmd === 'browser_chromium_download') throw new Error('network down');
        return undefined;
      });
      chromiumClient._mocks.listen = vi.fn(async () => () => {});
      render(<BrowserPane dark={false} />);
      await waitFor(() => expect(screen.getByTestId('chromium-consent')).toBeInTheDocument());
      fireEvent.click(screen.getByLabelText('Download Chromium'));
      await waitFor(() => expect(screen.getByTestId('chromium-error')).toHaveTextContent('network down'));
      // Banner stays so the user can retry.
      expect(screen.getByTestId('chromium-consent')).toBeInTheDocument();
    });
  });
});
