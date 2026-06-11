/**
 * PanelShell tests (#70 + #81).
 *
 * Exercises the layout shell in isolation (no App.tsx import):
 *   - register/toggle/open/close side panels
 *   - active panel renders in the right dock
 *   - tab strip appears with >1 open panel
 *   - dragging the divider resizes + persists width
 *   - open ids + dock sizes persist to localStorage['ollama_gui_layout']
 *   - a bottom-dock panel renders in the bottom region; height persists
 *   - on a mocked mobile width an open side panel hides the chat column
 *
 * The registry and open-store are module-level singletons, so each test cleans
 * up the panels it registered and clears the layout key.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  PanelShell,
  panelRegistry,
  openPanel,
  closePanel,
  togglePanel,
  isPanelOpen,
  type Panel,
} from '../components/PanelShell';

const LAYOUT_KEY = 'ollama_gui_layout';

// Helper: read the persisted layout object from localStorage.
function readLayout(): any {
  return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}');
}

// Build a trivial side panel whose body carries a recognizable marker.
function sidePanel(id: string, title: string): Panel {
  return { id, title, render: () => <div data-testid={`body-${id}`}>{`content-${id}`}</div> };
}

function bottomPanel(id: string, title: string): Panel {
  return { id, title, dock: 'bottom', render: () => <div data-testid={`body-${id}`}>{`bottom-${id}`}</div> };
}

// Track ids we register so we can tear them down deterministically.
const registered: string[] = [];
function reg(p: Panel) {
  panelRegistry.register(p);
  registered.push(p.id);
}

beforeEach(() => {
  // Reset persisted state and ensure a desktop viewport by default.
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
  act(() => { window.dispatchEvent(new Event('resize')); });
});

afterEach(() => {
  // Close + unregister anything a test left behind.
  for (const id of registered) { closePanel(id); panelRegistry.unregister(id); }
  registered.length = 0;
  localStorage.clear();
});

describe('panelRegistry', () => {
  it('register/list/unregister round-trip', () => {
    reg(sidePanel('alpha', 'Alpha'));
    expect(panelRegistry.list().some((p) => p.id === 'alpha')).toBe(true);
    panelRegistry.unregister('alpha');
    expect(panelRegistry.list().some((p) => p.id === 'alpha')).toBe(false);
  });

  it('notifies subscribers on change', () => {
    let hits = 0;
    const unsub = panelRegistry.subscribe(() => { hits++; });
    reg(sidePanel('beta', 'Beta'));
    expect(hits).toBeGreaterThan(0);
    unsub();
  });
});

describe('PanelShell open-state', () => {
  it('togglePanel opens and closes a panel', () => {
    reg(sidePanel('one', 'One'));
    expect(isPanelOpen('one')).toBe(false);
    act(() => togglePanel('one'));
    expect(isPanelOpen('one')).toBe(true);
    act(() => togglePanel('one'));
    expect(isPanelOpen('one')).toBe(false);
  });

  it('renders the active panel body in the right dock when opened', () => {
    reg(sidePanel('one', 'One'));
    render(<PanelShell dark={false}><div>chat</div></PanelShell>);
    expect(screen.queryByTestId('side-dock')).toBeNull();
    act(() => openPanel('one'));
    expect(screen.getByTestId('side-dock')).toBeInTheDocument();
    expect(screen.getByTestId('body-one').textContent).toBe('content-one');
  });

  it('shows a tab strip when two side panels are open', () => {
    reg(sidePanel('one', 'One'));
    reg(sidePanel('two', 'Two'));
    render(<PanelShell dark={true}><div>chat</div></PanelShell>);
    act(() => { openPanel('one'); openPanel('two'); });
    expect(screen.getByTestId('side-tabstrip')).toBeInTheDocument();
    expect(screen.getByTestId('side-tab-one')).toBeInTheDocument();
    expect(screen.getByTestId('side-tab-two')).toBeInTheDocument();
    // Clicking the second tab switches the active body.
    fireEvent.click(screen.getByTestId('side-tab-two'));
    expect(screen.getByTestId('body-two')).toBeInTheDocument();
  });

  it('persists open ids to localStorage', () => {
    reg(sidePanel('one', 'One'));
    act(() => openPanel('one'));
    expect(readLayout().open).toContain('one');
    act(() => closePanel('one'));
    expect(readLayout().open).not.toContain('one');
  });
});

describe('PanelShell resizing', () => {
  it('dragging the side divider updates and persists the dock width', () => {
    reg(sidePanel('one', 'One'));
    render(<PanelShell dark={false}><div>chat</div></PanelShell>);
    act(() => openPanel('one'));

    const before = readLayout().dockWidth as number;
    const divider = screen.getByTestId('side-divider');
    // Drag left by 80px → dock grows by ~80px (dragging left widens the dock).
    fireEvent.pointerDown(divider, { clientX: 500, pointerId: 1 });
    act(() => { fireEvent.pointerMove(window, { clientX: 420 }); });
    act(() => { fireEvent.pointerUp(window, { clientX: 420 }); });

    const after = readLayout().dockWidth as number;
    expect(after).toBe(before + 80);
    // And the live element reflects the new width.
    expect(screen.getByTestId('side-dock')).toHaveStyle({ width: `${after}px` });
  });

  it('enforces the minimum dock width', () => {
    reg(sidePanel('one', 'One'));
    render(<PanelShell dark={false}><div>chat</div></PanelShell>);
    act(() => openPanel('one'));
    const divider = screen.getByTestId('side-divider');
    // Drag far right → would shrink below 320; clamps at 320.
    fireEvent.pointerDown(divider, { clientX: 500, pointerId: 1 });
    act(() => { fireEvent.pointerMove(window, { clientX: 2000 }); });
    act(() => { fireEvent.pointerUp(window, { clientX: 2000 }); });
    expect(readLayout().dockWidth).toBe(320);
  });
});

describe('PanelShell bottom dock (#81)', () => {
  it('renders a bottom-dock panel in the bottom region', () => {
    reg(bottomPanel('term', 'Terminal'));
    render(<PanelShell dark={false}><div>chat</div></PanelShell>);
    expect(screen.queryByTestId('bottom-dock')).toBeNull();
    act(() => openPanel('term'));
    expect(screen.getByTestId('bottom-dock')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-panel-term')).toBeInTheDocument();
    expect(screen.getByTestId('body-term').textContent).toBe('bottom-term');
    // A bottom panel must NOT appear in the right side dock.
    expect(screen.queryByTestId('side-dock')).toBeNull();
  });

  it('persists bottom-dock height when the divider is dragged', () => {
    reg(bottomPanel('term', 'Terminal'));
    render(<PanelShell dark={true}><div>chat</div></PanelShell>);
    act(() => openPanel('term'));

    const before = readLayout().bottomHeight as number;
    const divider = screen.getByTestId('bottom-divider');
    // Drag up by 60px → bottom dock grows by ~60px.
    fireEvent.pointerDown(divider, { clientY: 400, pointerId: 1 });
    act(() => { fireEvent.pointerMove(window, { clientY: 340 }); });
    act(() => { fireEvent.pointerUp(window, { clientY: 340 }); });

    expect(readLayout().bottomHeight).toBe(before + 60);
    expect(screen.getByTestId('bottom-dock')).toHaveStyle({ height: `${before + 60}px` });
  });
});

describe('PanelShell responsiveness', () => {
  it('hides the chat column when a side panel is open on mobile (isMobile prop)', () => {
    reg(sidePanel('one', 'One'));
    render(<PanelShell dark={false} isMobile={true}><div data-testid="chat-child">chat</div></PanelShell>);
    // With no panel open, chat is visible.
    expect(screen.getByTestId('chat-child')).toBeInTheDocument();
    act(() => openPanel('one'));
    // Opening a side panel overlays full-width and hides the chat column.
    expect(screen.queryByTestId('chat-column')).toBeNull();
    expect(screen.queryByTestId('chat-child')).toBeNull();
    expect(screen.getByTestId('body-one')).toBeInTheDocument();
  });

  it('hides the chat column on a mocked mobile width via resize', () => {
    reg(sidePanel('one', 'One'));
    render(<PanelShell dark={false}><div data-testid="chat-child">chat</div></PanelShell>);
    act(() => openPanel('one'));
    // On desktop the chat column stays visible alongside the dock.
    expect(screen.getByTestId('chat-column')).toBeInTheDocument();
    // Shrink to a phone width and fire resize → chat column hides.
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 375 });
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.queryByTestId('chat-column')).toBeNull();
    expect(screen.queryByTestId('chat-child')).toBeNull();
  });
});
