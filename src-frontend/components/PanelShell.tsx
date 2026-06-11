/**
 * PanelShell (#70 + #81) — the single resizable multi-panel layout shell.
 *
 * This is the ONE place in the app allowed to split the Main Chat Area into a
 * chat column + a right dock + an optional bottom dock. Every side/bottom
 * surface in the app (browser, file tree, terminal, artifacts, compare, …)
 * MUST register through `panelRegistry` and dock here rather than adding its
 * own top-level child to the root flex h-screen layout. See docs/ui-panels.md
 * for the adoption contract.
 *
 * Layout, theming, and conventions mirror the rest of the codebase:
 *   - dark ? 'dark-classes' : 'light-classes' ternaries (no CSS variables).
 *   - All resizing uses native pointer events + controlled state (no new dep).
 *   - Open panel ids + dock width + bottom height persist to localStorage under
 *     a single key ('ollama_gui_layout') so the layout survives reloads.
 */

import React from 'react';

// ─── Public types ───────────────────────────────────────────────────────────

/** A dockable panel. `render(dark)` returns the panel body for the active theme. */
export interface Panel {
  id: string;
  title: string;
  /** Optional emoji/glyph shown in tab strips and the registry. */
  icon?: string;
  /**
   * Which dock the panel lives in. 'side' (default) docks into the right
   * column; 'bottom' docks into the resizable bottom region (terminal-style).
   */
  dock?: 'side' | 'bottom';
  /** Render the panel body. Receives the resolved dark flag. */
  render: (dark: boolean) => React.ReactNode;
}

// ─── Module-level registry ──────────────────────────────────────────────────

/**
 * A tiny observable registry of panels. Components register their panel once
 * (e.g. at module load or in a mount effect); the shell subscribes so it
 * re-renders whenever the set of registered panels changes.
 */
class PanelRegistry {
  private panels = new Map<string, Panel>();
  private listeners = new Set<() => void>();
  /**
   * Cached, immutable snapshot of the panel list. useSyncExternalStore requires
   * getSnapshot to return a stable reference between changes (else it loops);
   * we rebuild this only when the panel set actually mutates.
   */
  private snapshot: Panel[] = [];

  /** Register (or replace) a panel by id. Idempotent. */
  register(panel: Panel): void {
    this.panels.set(panel.id, panel);
    this.emit();
  }

  /** Remove a panel by id. No-op if absent. */
  unregister(id: string): void {
    if (this.panels.delete(id)) this.emit();
  }

  /** All registered panels, in insertion order (stable reference until changed). */
  list(): Panel[] {
    return this.snapshot;
  }

  /** Look up a single panel by id. */
  get(id: string): Panel | undefined {
    return this.panels.get(id);
  }

  /**
   * Subscribe to registry changes. Returns an unsubscribe fn. Designed to plug
   * directly into React's useSyncExternalStore.
   */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    // Rebuild the cached snapshot once per mutation, then notify subscribers.
    this.snapshot = Array.from(this.panels.values());
    this.listeners.forEach((l) => l());
  }
}

/** The shared, app-wide panel registry. */
export const panelRegistry = new PanelRegistry();

// ─── Open-state store (open panel ids + dock sizes) ─────────────────────────

const LAYOUT_KEY = 'ollama_gui_layout';

/** Persisted layout shape. */
interface LayoutState {
  /** Ids of panels the user currently has open. */
  open: string[];
  /** Right-dock width in px. */
  dockWidth: number;
  /** Bottom-dock height in px. */
  bottomHeight: number;
}

const DEFAULT_DOCK_WIDTH = 360; // a touch above the 320px minimum
const MIN_DOCK_WIDTH = 320;
const DEFAULT_BOTTOM_HEIGHT = 240;
const MIN_BOTTOM_HEIGHT = 120;

function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        open: Array.isArray(parsed.open) ? parsed.open.filter((x: unknown) => typeof x === 'string') : [],
        dockWidth: typeof parsed.dockWidth === 'number' ? parsed.dockWidth : DEFAULT_DOCK_WIDTH,
        bottomHeight: typeof parsed.bottomHeight === 'number' ? parsed.bottomHeight : DEFAULT_BOTTOM_HEIGHT,
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return { open: [], dockWidth: DEFAULT_DOCK_WIDTH, bottomHeight: DEFAULT_BOTTOM_HEIGHT };
}

function saveLayout(state: LayoutState): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota/serialization errors — layout is non-critical */
  }
}

/**
 * Open-state is tracked at module level (alongside the registry) so the
 * imperative open/close/toggle helpers below can be called from anywhere
 * (keyboard shortcuts, tool side-effects, App.tsx) without threading a setter
 * through props. The shell subscribes via the same observer pattern.
 */
class OpenStore {
  private state: LayoutState = loadLayout();
  private listeners = new Set<() => void>();

  getSnapshot(): LayoutState {
    return this.state;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isOpen(id: string): boolean {
    return this.state.open.includes(id);
  }

  open(id: string): void {
    if (this.state.open.includes(id)) return;
    this.set({ ...this.state, open: [...this.state.open, id] });
  }

  close(id: string): void {
    if (!this.state.open.includes(id)) return;
    this.set({ ...this.state, open: this.state.open.filter((x) => x !== id) });
  }

  toggle(id: string): void {
    this.isOpen(id) ? this.close(id) : this.open(id);
  }

  setDockWidth(px: number): void {
    const w = Math.max(MIN_DOCK_WIDTH, Math.round(px));
    if (w === this.state.dockWidth) return;
    this.set({ ...this.state, dockWidth: w });
  }

  setBottomHeight(px: number): void {
    const h = Math.max(MIN_BOTTOM_HEIGHT, Math.round(px));
    if (h === this.state.bottomHeight) return;
    this.set({ ...this.state, bottomHeight: h });
  }

  private set(next: LayoutState): void {
    this.state = next;
    saveLayout(next);
    this.listeners.forEach((l) => l());
  }
}

const openStore = new OpenStore();

// ─── Imperative open/close API (callable from anywhere) ─────────────────────

/** Open a panel (by registered id). Persists open-state. */
export function openPanel(id: string): void {
  openStore.open(id);
}

/** Close a panel (by registered id). Persists open-state. */
export function closePanel(id: string): void {
  openStore.close(id);
}

/** Toggle a panel's open-state (by registered id). Persists open-state. */
export function togglePanel(id: string): void {
  openStore.toggle(id);
}

/** Whether a panel is currently open. */
export function isPanelOpen(id: string): boolean {
  return openStore.isOpen(id);
}

// ─── Hooks bridging the module stores into React ────────────────────────────

/** Subscribe a component to registry changes; returns the current panel list. */
function useRegistry(): Panel[] {
  return React.useSyncExternalStore(
    (cb) => panelRegistry.subscribe(cb),
    () => panelRegistry.list(),
    () => panelRegistry.list(),
  );
}

/** Subscribe a component to open-state changes; returns the current layout. */
function useOpenState(): LayoutState {
  return React.useSyncExternalStore(
    (cb) => openStore.subscribe(cb),
    () => openStore.getSnapshot(),
    () => openStore.getSnapshot(),
  );
}

// ─── Shell component ────────────────────────────────────────────────────────

export interface PanelShellProps {
  /** The chat column (the existing Main Chat Area content). */
  children: React.ReactNode;
  dark: boolean;
  /**
   * Force the mobile layout. When omitted, the shell reads window.innerWidth
   * (< 768px = mobile) and tracks resize events.
   */
  isMobile?: boolean;
}

/** Read-only helper: current mobile state from the viewport. */
function readIsMobile(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

export function PanelShell({ children, dark, isMobile: isMobileProp }: PanelShellProps): React.ReactElement {
  const panels = useRegistry();
  const layout = useOpenState();

  // Track viewport-derived mobile state unless the parent forces it via prop.
  const [autoMobile, setAutoMobile] = React.useState<boolean>(readIsMobile);
  React.useEffect(() => {
    if (isMobileProp !== undefined) return; // parent controls it
    const onResize = () => setAutoMobile(readIsMobile());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isMobileProp]);
  const isMobile = isMobileProp ?? autoMobile;

  // Resolve open panels against the registry, split by dock.
  const openSide = panels.filter((p) => layout.open.includes(p.id) && (p.dock ?? 'side') === 'side');
  const openBottom = panels.filter((p) => layout.open.includes(p.id) && p.dock === 'bottom');

  // Active side panel (the one whose body shows). Default to the first open.
  const [activeSideId, setActiveSideId] = React.useState<string | null>(null);
  React.useEffect(() => {
    // Keep the active id valid as panels open/close.
    if (openSide.length === 0) {
      if (activeSideId !== null) setActiveSideId(null);
    } else if (!activeSideId || !openSide.some((p) => p.id === activeSideId)) {
      setActiveSideId(openSide[0].id);
    }
  }, [openSide, activeSideId]);
  const activeSide = openSide.find((p) => p.id === activeSideId) ?? openSide[0] ?? null;

  // ── Pointer-drag resize for the right dock ────────────────────────────────
  const sideDragRef = React.useRef<{ startX: number; startW: number } | null>(null);
  const onSideDividerDown = (e: React.PointerEvent) => {
    sideDragRef.current = { startX: e.clientX, startW: layout.dockWidth };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', onSideDividerMove);
    window.addEventListener('pointerup', onSideDividerUp);
  };
  const onSideDividerMove = (e: PointerEvent) => {
    const d = sideDragRef.current;
    if (!d) return;
    // Dragging left (smaller clientX) widens the right dock.
    openStore.setDockWidth(d.startW + (d.startX - e.clientX));
  };
  const onSideDividerUp = () => {
    sideDragRef.current = null;
    window.removeEventListener('pointermove', onSideDividerMove);
    window.removeEventListener('pointerup', onSideDividerUp);
  };

  // ── Pointer-drag resize for the bottom dock ───────────────────────────────
  const bottomDragRef = React.useRef<{ startY: number; startH: number } | null>(null);
  const onBottomDividerDown = (e: React.PointerEvent) => {
    bottomDragRef.current = { startY: e.clientY, startH: layout.bottomHeight };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', onBottomDividerMove);
    window.addEventListener('pointerup', onBottomDividerUp);
  };
  const onBottomDividerMove = (e: PointerEvent) => {
    const d = bottomDragRef.current;
    if (!d) return;
    // Dragging up (smaller clientY) grows the bottom dock.
    openStore.setBottomHeight(d.startH + (d.startY - e.clientY));
  };
  const onBottomDividerUp = () => {
    bottomDragRef.current = null;
    window.removeEventListener('pointermove', onBottomDividerMove);
    window.removeEventListener('pointerup', onBottomDividerUp);
  };

  // Detach any in-flight global listeners on unmount.
  React.useEffect(() => () => {
    window.removeEventListener('pointermove', onSideDividerMove);
    window.removeEventListener('pointerup', onSideDividerUp);
    window.removeEventListener('pointermove', onBottomDividerMove);
    window.removeEventListener('pointerup', onBottomDividerUp);
  }, []);

  // On mobile, an open side panel overlays full-width and hides the chat column.
  const sideOverlaysChat = isMobile && !!activeSide;

  return (
    <div data-testid="panel-shell" className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      {/* Top region: chat column + right dock side-by-side */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Chat column — hidden when a side panel overlays it on mobile */}
        {!sideOverlaysChat && (
          <div data-testid="chat-column" className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {children}
          </div>
        )}

        {/* Right dock — only rendered when at least one side panel is open */}
        {activeSide && (
          <>
            {/* Resize divider (hidden on mobile, where the dock is full-width) */}
            {!isMobile && (
              <div
                data-testid="side-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize side panel"
                onPointerDown={onSideDividerDown}
                className={`w-1 cursor-col-resize shrink-0 transition-colors ${
                  dark ? 'bg-zinc-700 hover:bg-blue-600' : 'bg-zinc-300 hover:bg-blue-500'
                }`}
              />
            )}
            <div
              data-testid="side-dock"
              style={isMobile ? undefined : { width: layout.dockWidth }}
              className={`flex flex-col min-h-0 shrink-0 border-l ${
                isMobile ? 'flex-1 w-full' : 'min-w-[320px]'
              } ${dark ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-200 bg-white'}`}
            >
              {/* Tab strip — shown when more than one side panel is open */}
              {openSide.length > 1 && (
                <div
                  data-testid="side-tabstrip"
                  className={`flex items-center gap-0.5 px-1 h-9 shrink-0 border-b overflow-x-auto ${
                    dark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'
                  }`}
                >
                  {openSide.map((p) => {
                    const active = p.id === activeSide.id;
                    return (
                      <button
                        key={p.id}
                        role="tab"
                        aria-selected={active}
                        data-testid={`side-tab-${p.id}`}
                        onClick={() => setActiveSideId(p.id)}
                        className={`group flex items-center gap-1 px-2.5 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
                          active
                            ? dark ? 'bg-zinc-700 text-zinc-100' : 'bg-white text-zinc-900 shadow-sm'
                            : dark ? 'text-zinc-400 hover:bg-zinc-700/50' : 'text-zinc-500 hover:bg-zinc-200'
                        }`}
                      >
                        {p.icon && <span aria-hidden>{p.icon}</span>}
                        <span>{p.title}</span>
                        <span
                          role="button"
                          aria-label={`Close ${p.title}`}
                          onClick={(e) => { e.stopPropagation(); closePanel(p.id); }}
                          className={`ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
                            dark ? 'hover:text-red-400' : 'hover:text-red-500'
                          }`}
                        >
                          ✕
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Single-panel header (when only one tab, show a title bar + close) */}
              {openSide.length === 1 && (
                <div
                  data-testid="side-header"
                  className={`flex items-center justify-between px-3 h-9 shrink-0 border-b ${
                    dark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'
                  }`}
                >
                  <span className={`flex items-center gap-1.5 text-xs font-medium ${dark ? 'text-zinc-300' : 'text-zinc-600'}`}>
                    {activeSide.icon && <span aria-hidden>{activeSide.icon}</span>}
                    {activeSide.title}
                  </span>
                  <button
                    aria-label={`Close ${activeSide.title}`}
                    onClick={() => closePanel(activeSide.id)}
                    className={`text-xs px-1.5 rounded transition-colors ${
                      dark ? 'text-zinc-400 hover:text-red-400 hover:bg-zinc-700' : 'text-zinc-500 hover:text-red-500 hover:bg-zinc-200'
                    }`}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Active side-panel body */}
              <div data-testid="side-body" className="flex-1 min-h-0 overflow-auto">
                {activeSide.render(dark)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom dock — terminal-style panels. Rendered below the top region. */}
      {openBottom.length > 0 && (
        <>
          <div
            data-testid="bottom-divider"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize bottom panel"
            onPointerDown={onBottomDividerDown}
            className={`h-1 cursor-row-resize shrink-0 transition-colors ${
              dark ? 'bg-zinc-700 hover:bg-blue-600' : 'bg-zinc-300 hover:bg-blue-500'
            }`}
          />
          <div
            data-testid="bottom-dock"
            style={{ height: layout.bottomHeight }}
            className={`flex flex-col shrink-0 border-t overflow-hidden ${
              dark ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-200 bg-white'
            }`}
          >
            {/* Bottom tab strip — always shown so panels are labelled/closable */}
            <div
              data-testid="bottom-tabstrip"
              className={`flex items-center gap-0.5 px-1 h-8 shrink-0 border-b overflow-x-auto ${
                dark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'
              }`}
            >
              {openBottom.map((p) => (
                <span
                  key={p.id}
                  data-testid={`bottom-tab-${p.id}`}
                  className={`group flex items-center gap-1 px-2.5 py-0.5 text-xs rounded-md whitespace-nowrap ${
                    dark ? 'text-zinc-300 bg-zinc-700/50' : 'text-zinc-600 bg-zinc-200/70'
                  }`}
                >
                  {p.icon && <span aria-hidden>{p.icon}</span>}
                  <span>{p.title}</span>
                  <button
                    aria-label={`Close ${p.title}`}
                    onClick={() => closePanel(p.id)}
                    className={`ml-0.5 transition-colors ${dark ? 'hover:text-red-400' : 'hover:text-red-500'}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            {/* Stack each open bottom panel's body. (Terminals etc. coexist.) */}
            <div data-testid="bottom-body" className="flex-1 min-h-0 overflow-auto">
              {openBottom.map((p) => (
                <div key={p.id} data-testid={`bottom-panel-${p.id}`} className="h-full">
                  {p.render(dark)}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default PanelShell;
