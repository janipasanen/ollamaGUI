/**
 * Dropdown that escapes a clipping ancestor (#487).
 *
 * The header carries `overflow-x-auto` so the toolbar can scroll at narrow
 * widths (#450), but that establishes a *clipping container*: an
 * absolutely-positioned menu anchored below the 56px-tall header is simply cut
 * away. No z-index fixes this — clipping by an ancestor's overflow is not a
 * stacking-order problem. So header menus render in a portal on document.body
 * with fixed coordinates taken from their trigger.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface AnchoredMenuProps {
  /** The element the menu is positioned against. */
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  dark: boolean;
  children: React.ReactNode;
  /** Which edge of the anchor the menu aligns to. */
  align?: 'left' | 'right';
  className?: string;
  ariaLabel?: string;
}

interface Pos { top: number; left: number }

const GAP = 4;
const MARGIN = 8;

export const AnchoredMenu: React.FC<AnchoredMenuProps> = ({
  anchorRef, open, onClose, dark, children, align = 'left', className = '', ariaLabel,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  // Measure before paint so the menu never flashes at the wrong spot.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }

    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const a = anchor.getBoundingClientRect();
      const menuW = menuRef.current?.offsetWidth ?? 0;
      const menuH = menuRef.current?.offsetHeight ?? 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = align === 'right' ? a.right - menuW : a.left;
      // Keep the menu on screen horizontally.
      left = Math.max(MARGIN, Math.min(left, vw - menuW - MARGIN));

      // Flip above the anchor when there is no room below.
      let top = a.bottom + GAP;
      if (menuH && top + menuH > vh - MARGIN) {
        const above = a.top - GAP - menuH;
        if (above >= MARGIN) top = above;
        else top = Math.max(MARGIN, vh - menuH - MARGIN);
      }

      setPos({ top, left });
    };

    place();
    // The anchor moves when the toolbar scrolls or the window resizes.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, anchorRef]);

  // Escape / outside click dismissal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return; // let the trigger toggle itself
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        // Hidden until measured, so it cannot flash in the corner.
        visibility: pos ? 'visible' : 'hidden',
        zIndex: 1000,
      }}
      className={`rounded-md border shadow-lg py-1 ${
        dark ? 'bg-zinc-800 border-zinc-700 text-zinc-200' : 'bg-white border-zinc-200 text-zinc-800'
      } ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
};

export default AnchoredMenu;
