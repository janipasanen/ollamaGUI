import React from 'react';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * Floating right-click context menu (#378).
 *
 * Renders a fixed-position list of menu items at the cursor location. Closes on
 * outside mousedown, Escape, or window scroll. Each item is a `role="menuitem"`
 * button so the menu is keyboard/screen-reader accessible.
 */
export const ContextMenu: React.FC<{
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  dark?: boolean;
}> = ({ x, y, items, onClose, dark }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  // Measured position, clamped/flipped to stay on screen (#506). Rendered
  // hidden for the first paint so it is never briefly visible at the raw
  // cursor point when that point is near the right/bottom edge.
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      // Measured while parked at the origin, so the shrink-to-fit width is not
      // capped by the cursor's distance from the right edge (which produced a
      // wrapped, too-narrow box and a wrong clamp).
      const { offsetWidth: w, offsetHeight: h } = el;
      const M = 8;
      // Prefer opening down-right of the cursor; flip to the other side when
      // there is not enough room, then clamp so it can never leave the viewport.
      let left = x + w + M > window.innerWidth ? x - w : x;
      let top = y + h + M > window.innerHeight ? y - h : y;
      left = Math.max(M, Math.min(left, window.innerWidth - w - M));
      top = Math.max(M, Math.min(top, window.innerHeight - h - M));
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [x, y, items.length]);

  // Return focus where it came from (#514). Without this the menu closes and
  // focus lands on document.body, stranding keyboard users at the top of the page.
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const menu = ref.current;
    return () => {
      // Only reclaim focus if it is still inside the menu we are removing.
      // Restoring unconditionally stole focus from whatever the chosen item
      // opened: this cleanup is a passive-effect destroy, so it runs AFTER the
      // autoFocus of a newly mounted field — the sidebar rename input was
      // blurred the instant it appeared, firing commitRename() and closing it.
      const active = document.activeElement;
      const focusLeftWithMenu = !active || active === document.body || (menu?.contains(active) ?? false);
      if (focusLeftWithMenu) previous?.focus?.();
    };
  }, []);

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  // Focus the first enabled item on open and support ArrowUp/Down/Home/End
  // navigation between items (#452).
  React.useEffect(() => {
    if (!pos) return; // still parked off-screen; focus once placed
    const first = ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    first?.focus();
  }, [pos]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    if (buttons.length === 0) return;
    e.preventDefault();
    const active = document.activeElement as HTMLButtonElement | null;
    const idx = active ? buttons.indexOf(active) : -1;
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else if (e.key === 'ArrowDown') next = idx < 0 || idx === buttons.length - 1 ? 0 : idx + 1;
    else next = idx <= 0 ? buttons.length - 1 : idx - 1;
    buttons[next].focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Message actions"
      data-testid="message-context-menu"
      onKeyDown={onMenuKeyDown}
      style={{
        position: 'fixed',
        // Park it far off-screen for the measuring pass rather than using
        // visibility:hidden — browsers refuse focus inside a hidden subtree, so
        // the first-item autofocus silently no-opped and the arrow-key handler
        // never received any keys. jsdom ignores CSS visibility, so no test
        // could catch that.
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : -9999,
        zIndex: 60,
      }}
      className={`min-w-[160px] py-1 rounded-lg border shadow-lg text-sm ${dark ? 'bg-zinc-800 border-zinc-700 text-zinc-200' : 'bg-white border-zinc-300 text-zinc-800'}`}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => { if (!item.disabled) { item.onSelect(); onClose(); } }}
          className={`block w-full text-left px-3 py-1.5 ${item.disabled ? 'opacity-40 cursor-not-allowed' : (dark ? 'hover:bg-zinc-700' : 'hover:bg-zinc-100')}`}
        >{item.label}</button>
      ))}
    </div>
  );
};
