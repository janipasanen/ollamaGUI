/**
 * Built-in browser session state + event bus (#65, foundation).
 *
 * This module is the stable foundation that downstream browser workers import.
 * It owns:
 *   - the canonical in-memory `BrowserState` (the live view of the embedded
 *     browser surface: current/typed URL, preview visibility, render mode, and
 *     the latest accessibility-tree ref map),
 *   - a tiny pub/sub `browserBus` whose listener pattern structurally mirrors
 *     `McpStdioClient` in services/mcp.ts (a Map of event -> Set of callbacks),
 *   - typed setters on the `browserSession` singleton that mutate state in place
 *     and emit the matching bus event so the UI/automation layers stay in sync,
 *   - `isLocalhostUrl`, the routing predicate that decides whether a URL is the
 *     local dev surface (iframe-friendly) or an external origin (native child
 *     webview, per ADR-0001).
 *
 * No Tauri/IPC here on purpose — keeping it pure makes it trivially testable and
 * lets it run unchanged under vitest/jsdom.
 */

// ---------------------------------------------------------------------------
// State model
// ---------------------------------------------------------------------------

/**
 * A single accessibility-tree reference produced by a page snapshot.
 *
 * `role` and `name` come from the AX node; `isSecret` flags refs that resolve to
 * password / sensitive inputs so the automation/guardrail layers can redact
 * values and gate writes (see ADR-0001 guardrails).
 */
export interface SnapshotRef {
  role: string;
  name: string;
  isSecret?: boolean;
}

/**
 * The live, in-memory state of the built-in browser surface.
 *
 * - `currentUrl`  — the URL actually committed/loaded in the surface.
 * - `navUrl`      — the URL currently typed in the address bar (may differ from
 *                   `currentUrl` until the user/agent navigates).
 * - `isPreviewOpen` — whether the browser preview pane is visible.
 * - `mode`        — render strategy: `'iframe'` for the local dev surface,
 *                   `'webview'` for an external native child webview.
 * - `engineConnected` — whether the CDP/Chromium automation engine is attached.
 * - `lastSnapshotRefs` — the most recent AX-tree ref map (ref id -> node info),
 *                   keyed by the stable `eNN` ids used by the page model.
 */
export interface BrowserState {
  currentUrl: string;
  navUrl: string;
  isPreviewOpen: boolean;
  mode: 'iframe' | 'webview';
  engineConnected: boolean;
  lastSnapshotRefs: Record<string, SnapshotRef>;
}

// ---------------------------------------------------------------------------
// Event bus
// ---------------------------------------------------------------------------

/**
 * The set of events emitted on `browserBus`.
 *
 *  - `navigate`      — `navUrl` changed (address-bar / programmatic intent).
 *  - `loaded`        — `currentUrl` committed (a page finished loading).
 *  - `snapshot`      — a new AX-tree snapshot (`lastSnapshotRefs`) is available.
 *  - `console`       — a forwarded page console message.
 *  - `engine-status` — `engineConnected` changed / engine lifecycle update.
 *  - `screenshot`    — a screenshot capture is available.
 *  - `audit`         — a guardrail/approval audit record was produced.
 */
export type BrowserEvent =
  | 'navigate'
  | 'loaded'
  | 'snapshot'
  | 'console'
  | 'engine-status'
  | 'screenshot'
  | 'audit';

/** Readonly catalogue of every {@link BrowserEvent}, handy for fan-out/wiring. */
export const BROWSER_EVENTS = [
  'navigate',
  'loaded',
  'snapshot',
  'console',
  'engine-status',
  'screenshot',
  'audit',
] as const;

/** Listener signature. Payload shape is event-specific and intentionally loose. */
export type BrowserListener = (payload: any) => void;

/**
 * Minimal event emitter, structurally mirroring the `McpStdioClient` listener
 * pattern (services/mcp.ts) but backed by a `Set` per event so duplicate
 * registrations collapse and `off` is O(1).
 */
class BrowserBus {
  // event -> set of listeners. Using a Set (vs the array in McpStdioClient)
  // de-dupes identical callbacks and makes off()/has() trivial.
  private listeners: Map<BrowserEvent, Set<BrowserListener>> = new Map();

  /** Subscribe `cb` to `event`. Re-subscribing the same fn is a no-op. */
  on(event: BrowserEvent, cb: BrowserListener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
  }

  /** Unsubscribe `cb` from `event`. Safe to call for unknown events/listeners. */
  off(event: BrowserEvent, cb: BrowserListener): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(cb);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /** Fire `event`, invoking every current listener with `payload`. */
  emit(event: BrowserEvent, payload?: any): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Snapshot to an array so a listener that unsubscribes during dispatch
    // doesn't mutate the set we're iterating.
    Array.from(set).forEach((cb) => cb(payload));
  }
}

/** The shared browser event bus singleton. */
export const browserBus = new BrowserBus();

// ---------------------------------------------------------------------------
// Session singleton
// ---------------------------------------------------------------------------

/**
 * The canonical browser session singleton: it holds the {@link BrowserState}
 * fields directly and exposes typed setters that mutate in place and emit the
 * matching {@link browserBus} event. Downstream code reads fields directly and
 * mutates only through the setters so emissions never get skipped.
 */
class BrowserSession implements BrowserState {
  currentUrl = '';
  navUrl = '';
  isPreviewOpen = false;
  mode: 'iframe' | 'webview' = 'iframe';
  engineConnected = false;
  lastSnapshotRefs: Record<string, SnapshotRef> = {};

  /** Commit a loaded URL; emits `loaded` with the new value. */
  setCurrentUrl(value: string): void {
    this.currentUrl = value;
    browserBus.emit('loaded', value);
  }

  /** Update the address-bar/target URL; emits `navigate` with the new value. */
  setNavUrl(value: string): void {
    this.navUrl = value;
    browserBus.emit('navigate', value);
  }

  /** Toggle the preview pane visibility; emits `screenshot` is NOT used here. */
  setIsPreviewOpen(value: boolean): void {
    this.isPreviewOpen = value;
    // Preview visibility rides the `engine-status` channel since it gates the
    // surface the engine renders into; payload carries the new open flag.
    browserBus.emit('engine-status', { isPreviewOpen: value });
  }

  /** Switch render mode between iframe/webview; emits `navigate` re-route hint. */
  setMode(value: 'iframe' | 'webview'): void {
    this.mode = value;
    browserBus.emit('navigate', { mode: value, url: this.navUrl });
  }

  /** Update engine connectivity; emits `engine-status` with the new flag. */
  setEngineConnected(value: boolean): void {
    this.engineConnected = value;
    browserBus.emit('engine-status', { engineConnected: value });
  }

  /** Replace the AX-tree ref map; emits `snapshot` with the new refs. */
  setLastSnapshotRefs(value: Record<string, SnapshotRef>): void {
    this.lastSnapshotRefs = value;
    browserBus.emit('snapshot', value);
  }
}

/** The shared browser session singleton. */
export const browserSession = new BrowserSession();

// ---------------------------------------------------------------------------
// URL routing predicate
// ---------------------------------------------------------------------------

/**
 * The default local dev server URL (Vite). Used as a configurable allow entry
 * so the local app surface routes through the iframe path, not a native webview.
 */
export const DEFAULT_DEV_URL = 'http://localhost:5173';

/**
 * Hostnames that always count as localhost regardless of port.
 *
 * IPv6 loopback is listed in its bracketed form `[::1]` because that is exactly
 * what `URL.hostname` yields (it also normalizes the long `0:0:...:1` form to
 * `[::1]`); the bare `::1` is kept too for inputs that bypass the URL parser.
 */
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/**
 * Extract the bare hostname from a URL that may or may not carry a protocol,
 * with or without a port, and with IPv6 in bracket form. Returns '' when the
 * input can't be parsed into a host.
 */
function extractHost(url: string): string {
  if (!url) return '';
  let s = url.trim();

  // Ensure the URL parser has a scheme to work with; default to http:// so we
  // can robustly handle inputs like "localhost:3000" or "127.0.0.1".
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) {
    s = `http://${s}`;
  }

  try {
    const u = new URL(s);
    // u.hostname already strips the port and the surrounding [] for IPv6.
    return u.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * True when `url` points at the local machine (localhost, 127.0.0.1, [::1],
 * 0.0.0.0 — on any port) or matches the configurable dev URL host.
 *
 * Robust to inputs with or without a protocol. Used by the routing layer to
 * decide iframe (local) vs native child webview (external), per ADR-0001.
 *
 * @param url    the candidate URL (e.g. "http://localhost:5173", "127.0.0.1:3000").
 * @param devUrl the configured dev server URL whose host also counts as local.
 */
export function isLocalhostUrl(url: string, devUrl: string = DEFAULT_DEV_URL): boolean {
  const host = extractHost(url);
  if (!host) return false;
  if (LOCALHOST_HOSTS.has(host)) return true;

  const devHost = extractHost(devUrl);
  return devHost !== '' && host === devHost;
}
