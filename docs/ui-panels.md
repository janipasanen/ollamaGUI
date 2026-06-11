# UI Panels — the PanelShell adoption contract (#70, #81)

The app has **one** resizable multi-panel layout shell:
[`src-frontend/components/PanelShell.tsx`](../src-frontend/components/PanelShell.tsx).

Every side or bottom surface in the app — the browser, file tree, terminal,
artifacts canvas, diff/compare view, and anything added later — docks **into**
that shell. This document is the contract every such surface must follow.

## Why a single shell

Before PanelShell, each new feature was tempted to add its own top-level child
to the root `flex h-screen` layout (or to re-split the Main Chat Area), which
produced overlapping, non-resizable, mutually-unaware panels. PanelShell owns
the one horizontal split (chat column + right dock) plus the one optional
bottom dock, so panels share a consistent resize/tab/persist behaviour.

## The contract

1. **Register, do not re-layout.** A panel MUST register itself with
   `panelRegistry` and let the shell place it. No component may:
   - add a new top-level child to the root `flex h-screen` container, or
   - re-split / wrap the Main Chat Area (`flex-1 flex flex-col relative
     overflow-hidden`) with its own columns.

2. **One registration per surface.** Register once (at module load, or in a
   mount effect) and `unregister` on teardown if the surface is dynamic.

3. **Theme via the `dark` flag.** `render(dark)` receives the resolved theme
   flag. Panels follow the `dark ? 'dark-classes' : 'light-classes'` convention
   (no CSS variables), matching the rest of the codebase.

4. **Open-state is owned by the shell.** Toggle visibility with the exported
   `openPanel(id)` / `closePanel(id)` / `togglePanel(id)` helpers. Do not keep a
   private "is my panel showing" boolean — the shell persists open-state for you.

## API

```ts
import {
  panelRegistry,
  openPanel, closePanel, togglePanel, isPanelOpen,
  type Panel,
} from './components/PanelShell';

// A panel descriptor.
interface Panel {
  id: string;                                  // unique, stable
  title: string;                               // shown in tab strip / header
  icon?: string;                               // optional emoji/glyph
  dock?: 'side' | 'bottom';                    // default 'side'
  render: (dark: boolean) => React.ReactNode;  // panel body
}

// Register a right-dock (side) panel.
panelRegistry.register({
  id: 'browser',
  title: 'Browser',
  icon: '🌐',
  render: (dark) => <BrowserPanel dark={dark} />,
});

// Register a bottom-dock (terminal-style) panel.
panelRegistry.register({
  id: 'terminal',
  title: 'Terminal',
  icon: '▶',
  dock: 'bottom',
  render: (dark) => <TerminalPanel dark={dark} />,
});

// Show / hide from anywhere (keyboard shortcut, toolbar button, tool side-effect).
togglePanel('browser');
openPanel('terminal');
closePanel('browser');
```

`panelRegistry` also exposes `unregister(id)`, `list()`, `get(id)`, and
`subscribe(cb)` (the shell uses `subscribe` via `useSyncExternalStore` to
re-render when the registered set changes).

## Layout behaviour

- **Right dock (side panels).** Minimum width `320px`, resizable by dragging the
  `border-l` divider (native pointer events, no extra dependency). When more
  than one side panel is open a **tab strip** appears; with exactly one open a
  title bar with a close button is shown instead.
- **Bottom dock (bottom panels).** Resizable height via a horizontal divider;
  terminal-style panels designated with `dock: 'bottom'`. Open bottom panels are
  stacked and each is labelled/closable in the bottom tab strip.
- **Persistence.** Open panel ids, the right-dock width, and the bottom-dock
  height are persisted together under `localStorage['ollama_gui_layout']`, so
  the layout survives reloads.
- **Responsiveness.** On a mobile viewport (`window.innerWidth < 768`, or the
  `isMobile` prop) an open side panel **overlays full-width and hides the chat
  column**, so the panel is usable on a phone. Pass `isMobile` explicitly to
  override the viewport check.

## Where panels live

| Surface          | dock     | id (suggested) |
| ---------------- | -------- | -------------- |
| Browser          | side     | `browser`      |
| File tree        | side     | `files`        |
| Artifacts canvas | side     | `artifacts`    |
| Diff / compare   | side     | `compare`      |
| Terminal         | bottom   | `terminal`     |

All of the above dock through PanelShell. If you are building a new side or
bottom surface, add a row here and register through `panelRegistry` — do not
introduce a parallel layout container.

## Adoption in App.tsx

`PanelShell` wraps (does not replace) the existing Main Chat Area:

```tsx
<PanelShell dark={dark}>
  {/* the existing chat column markup stays exactly as-is */}
</PanelShell>
```

The chat column remains `flex-1`; PanelShell adds the right dock and bottom dock
around it. The wrap is intentionally minimal and reversible.
