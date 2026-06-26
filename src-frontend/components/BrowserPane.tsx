/**
 * BrowserPane (#71, #72).
 *
 * The docked browser surface. It reads the shared `browserSession` state and the
 * `browserBus` event bus (services/browser.ts) and renders one of two things,
 * chosen by `isLocalhostUrl`:
 *
 *   - **Local dev URLs** (localhost / 127.0.0.1 / the dev host) render in a plain
 *     sandboxed `<iframe>` — cheap and iframe-friendly.
 *   - **External origins** render a placeholder host `<div id="browser-webview-host">`
 *     and, in Tauri mode, ask the Rust side to mount a *native child webview*
 *     layered over that div (`preview_webview_open`), because external sites
 *     routinely refuse to be framed. In browser/test mode (no Tauri) we just show
 *     an explanatory note in the placeholder.
 *
 * The native webview is positioned to match the placeholder's on-screen rect; a
 * `ResizeObserver` + `window.resize` listener re-sends the geometry via
 * `preview_webview_set_bounds` so it tracks layout changes.
 *
 * On mount the pane registers itself with `panelRegistry` (id `'browser'`) so the
 * PanelShell dock can surface it.
 *
 * Theming follows the repo's `dark ? … : …` ternary convention (no CSS vars).
 *
 * A mutable `_mocks.invoke` seam lets tests assert the geometry/open IPC calls
 * without a real Tauri runtime, exactly like the service modules do.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
// NOTE on import paths: this file lives in src-frontend/components/, so the
// shared browser service (src-frontend/services/browser.ts) is reached via
// '../services/browser' and the sibling PanelShell via './PanelShell'. The issue
// text quotes these as './browser' / '../components/PanelShell' from a
// services-relative vantage point; the physically-correct paths are used here.
import { browserSession, browserBus, isLocalhostUrl } from '../services/browser';
import { panelRegistry } from './PanelShell';

// ---------------------------------------------------------------------------
// Tauri invoke seam
// ---------------------------------------------------------------------------

/**
 * Test seam. When `_mocks.invoke` is set, every IPC call routes through it so a
 * test can assert the command name + args (geometry rects, urls) without a live
 * Tauri. When null we dynamic-import the real `@tauri-apps/api/core` — guarded so
 * that in pure browser/jsdom mode (no Tauri) the import failure degrades to a
 * no-op instead of throwing.
 */
export const _mocks = {
  invoke: null as ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null,
};

/** True when we believe a Tauri runtime is present (or a mock is wired in). */
function hasTauri(): boolean {
  if (_mocks.invoke) return true;
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as any);
}

/**
 * Invoke a Tauri command through the mock seam or the real core, returning
 * `undefined` (never throwing) when no runtime is available so the UI can keep
 * working in browser mode.
 */
async function tauriInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T | undefined> {
  try {
    if (_mocks.invoke) return (await _mocks.invoke(cmd, args)) as T;
    if (!hasTauri()) return undefined;
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch {
    // Browser mode / missing command — degrade gracefully.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Geometry helper
// ---------------------------------------------------------------------------

/** The rect (logical px) sent to the native preview, from an element's box. */
export interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Read an element's on-screen rect as a plain {@link PreviewRect}. */
function rectOf(el: HTMLElement | null): PreviewRect {
  if (!el || typeof el.getBoundingClientRect !== 'function') {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface BrowserPaneProps {
  dark: boolean;
}

export default function BrowserPane({ dark }: BrowserPaneProps) {
  // Address-bar text, seeded from the shared session.
  const [navUrl, setNavUrl] = useState<string>(browserSession.navUrl || '');
  // Whether we're routing the current url to the native webview host (external)
  // vs the iframe (local). Derived from the committed nav url.
  const isLocal = isLocalhostUrl(navUrl);
  // Force-remount key for the iframe: bumping it re-creates the iframe element so
  // a reload genuinely re-fetches (src alone won't reload if it's unchanged).
  const [iframeKey, setIframeKey] = useState<number>(0);
  // Auto-reload: when on, a `loaded` bus event bumps the iframe key.
  const [autoReload, setAutoReload] = useState<boolean>(false);

  // The placeholder host element the native webview is layered over.
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Latest auto-reload flag for use inside stable bus listeners.
  const autoReloadRef = useRef<boolean>(autoReload);
  autoReloadRef.current = autoReload;

  // -------------------------------------------------------------------------
  // Native-webview geometry sync
  // -------------------------------------------------------------------------

  /** Push the current host rect to the native preview (external mode only). */
  const syncBounds = useCallback(() => {
    if (isLocalhostUrl(browserSession.navUrl)) return;
    const rect = rectOf(hostRef.current);
    void tauriInvoke('preview_webview_set_bounds', { rect });
  }, []);

  /** Open/route the native preview for the given external url. */
  const openNativePreview = useCallback((url: string) => {
    const rect = rectOf(hostRef.current);
    void tauriInvoke('preview_webview_open', { url, rect, allow: [] });
  }, []);

  // -------------------------------------------------------------------------
  // Bus subscriptions
  // -------------------------------------------------------------------------

  useEffect(() => {
    // `navigate`: a new target url was committed (address bar or programmatic).
    const onNavigate = (payload: any) => {
      // Payload may be a bare string (setNavUrl) or an object (setMode).
      const url = typeof payload === 'string' ? payload : payload?.url;
      if (typeof url === 'string') {
        setNavUrl(url);
        if (isLocalhostUrl(url)) {
          // Leaving external mode — tear any native preview down.
          void tauriInvoke('preview_webview_close', {});
        } else {
          openNativePreview(url);
        }
      }
    };

    // `loaded`: a page finished loading. Under auto-reload, force the iframe to
    // remount so the local surface reflects the latest build.
    const onLoaded = () => {
      if (autoReloadRef.current) {
        setIframeKey((k) => k + 1);
      }
    };

    browserBus.on('navigate', onNavigate);
    browserBus.on('loaded', onLoaded);
    return () => {
      browserBus.off('navigate', onNavigate);
      browserBus.off('loaded', onLoaded);
    };
  }, [openNativePreview]);

  // -------------------------------------------------------------------------
  // Panel registration
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Register with the PanelShell dock. Guarded with optional chaining so the
    // component is resilient to the registry's exact API surface (and to tests
    // that stub the module).
    try {
      (panelRegistry as any)?.register?.({
        id: 'browser',
        title: 'Browser',
        // The shell renders us with the active dark flag; we keep our own copy in
        // the prop for direct renders, but expose a renderer for the dock too.
        render: (darkFlag: boolean) => <BrowserPane dark={darkFlag} />,
      });
    } catch {
      /* registry not available (e.g. isolated test) — non-fatal. */
    }
    return () => {
      try {
        (panelRegistry as any)?.unregister?.('browser');
      } catch {
        /* non-fatal */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // ResizeObserver + window resize → set_bounds (external host tracking)
  // -------------------------------------------------------------------------

  useEffect(() => {
    const onResize = () => syncBounds();
    window.addEventListener('resize', onResize);

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && hostRef.current) {
      ro = new ResizeObserver(() => syncBounds());
      ro.observe(hostRef.current);
    }
    return () => {
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [syncBounds]);

  // When we switch into external mode, (re)open + position the native preview.
  useEffect(() => {
    if (!isLocal && navUrl) {
      openNativePreview(navUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocal]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  /** Submit the address bar: commit the typed url onto the shared session. */
  const go = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const url = navUrl.trim();
      if (!url) return;
      // Emit through the bus so the rest of the browser stack (automation,
      // session state) sees the navigation intent. We mirror `setNavUrl`'s
      // string payload shape.
      browserBus.emit('navigate', url);
    },
    [navUrl],
  );

  /** Reload: bump the iframe key (local) or ask the native preview to reload. */
  const reload = useCallback(() => {
    if (isLocalhostUrl(browserSession.navUrl) || isLocal) {
      setIframeKey((k) => k + 1);
    } else {
      void tauriInvoke('preview_webview_reload', {});
    }
  }, [isLocal]);

  /** Back / Forward are navigation intents the engine layer fulfils. */
  const goBack = useCallback(() => browserBus.emit('navigate', { direction: 'back', url: browserSession.navUrl }), []);
  const goForward = useCallback(() => browserBus.emit('navigate', { direction: 'forward', url: browserSession.navUrl }), []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const btnCls = `p-1.5 rounded-md text-sm transition-colors ${
    dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'
  }`;

  return (
    <div
      data-testid="browser-pane"
      className={`flex flex-col h-full ${dark ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-700'}`}
    >
      {/* Toolbar: nav buttons + address bar + auto-reload */}
      <div
        className={`flex items-center gap-1 px-2 h-11 shrink-0 border-b ${
          dark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'
        }`}
      >
        <button type="button" onClick={goBack} aria-label="Back" title="Back" className={btnCls}>
          ←
        </button>
        <button type="button" onClick={goForward} aria-label="Forward" title="Forward" className={btnCls}>
          →
        </button>
        <button type="button" onClick={reload} aria-label="Reload" title="Reload" className={btnCls}>
          ⟳
        </button>

        <form onSubmit={go} className="flex-1 flex items-center gap-1">
          <input
            type="text"
            value={navUrl}
            onChange={(e) => setNavUrl(e.target.value)}
            aria-label="Address bar"
            placeholder="http://localhost:5173"
            className={`flex-1 text-sm rounded-md px-2 py-1 border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              dark ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-900'
            }`}
          />
          <button
            type="submit"
            aria-label="Go"
            title="Navigate"
            className="text-xs px-3 py-1 rounded font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            Go
          </button>
        </form>

        <label className={`flex items-center gap-1 text-xs cursor-pointer select-none ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
          <input
            type="checkbox"
            checked={autoReload}
            onChange={(e) => setAutoReload(e.target.checked)}
            aria-label="Auto-reload"
          />
          Auto
        </label>
      </div>

      {/* Surface: iframe (local) or native-webview host placeholder (external) */}
      <div className="flex-1 relative overflow-hidden">
        {isLocal ? (
          <iframe
            key={iframeKey}
            data-testid="browser-iframe"
            data-iframe-key={iframeKey}
            src={navUrl}
            title="preview"
            className="w-full h-full border-0"
          />
        ) : (
          <div
            id="browser-webview-host"
            ref={hostRef}
            data-testid="browser-webview-host"
            className={`w-full h-full flex items-center justify-center text-sm ${
              dark ? 'bg-zinc-950 text-zinc-500' : 'bg-zinc-100 text-zinc-400'
            }`}
          >
            {!hasTauri() && <span>native preview unavailable in browser mode</span>}
          </div>
        )}
      </div>
    </div>
  );
}
