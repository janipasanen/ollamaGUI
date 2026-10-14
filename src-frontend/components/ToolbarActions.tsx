/**
 * Header toolbar that collapses instead of overflowing (#495).
 *
 * The header is a single non-wrapping row with `overflow-x-auto`. As the
 * toolbar grew (artifacts, files, browser, terminal, code search, source
 * control, checkpoints, activity, stats, copy, export, help) its content
 * reached ~1528px, so at 1280px five controls were pushed out of sight and at
 * 1024px eleven were — including **Settings** and every panel toggle. Nothing
 * indicated they existed: a 40px-tall scroll strip shows no scrollbar under
 * macOS overlay-scrollbar defaults.
 *
 * Items that do not fit move into an overflow menu rather than off-screen. The
 * menu is portaled through AnchoredMenu so it is not clipped by the same
 * `overflow-x-auto` that caused #487.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnchoredMenu } from './AnchoredMenu';

export interface ToolbarAction {
  id: string;
  /** Glyph shown in the inline button. */
  icon: React.ReactNode;
  /** Human-readable name, used for the tooltip and the overflow-menu row. */
  label: string;
  onSelect: () => void;
  active?: boolean;
  disabled?: boolean;
}

export interface ToolbarActionsProps {
  items: ToolbarAction[];
  dark: boolean;
  /** Rendered before the collapsible items and never collapsed. */
  children?: React.ReactNode;
}

/** Width of one icon button (p-2 + a single glyph) plus the row's gap. */
const ITEM_W = 40;
/** Space kept for the "⋯" trigger whenever anything is collapsed. */
const MORE_W = 40;

export const ToolbarActions: React.FC<ToolbarActionsProps> = ({ items, dark, children }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(items.length);
  /** Header width at which each item index was folded away (#495 restore). */
  const droppedAtRef = useRef<Record<number, number>>({});
  const [menuOpen, setMenuOpen] = useState(false);

  /**
   * Converge on the largest number of inline items the header can hold.
   *
   * Measuring "available width" directly is unreliable here — this cluster is
   * nested several levels inside the header, so summing sibling widths misses
   * most of the row. Instead observe the header's ACTUAL overflow and step the
   * count until it fits, restoring items when the window grows again. The
   * hysteresis (needing a full item's slack plus the ⋯ button before adding one
   * back) keeps it from oscillating between two states.
   */
  const measure = useCallback(() => {
    const el = wrapRef.current;
    const header = el?.closest('header');
    if (!el || !header) return;

    const overflow = header.scrollWidth - header.clientWidth;
    const width = header.clientWidth;

    setVisible(prev => {
      if (overflow > 0) {
        const drop = Math.ceil(overflow / ITEM_W);
        // Reserve room for the ⋯ trigger the first time anything collapses.
        const reserve = prev === items.length ? 1 : 0;
        const next = Math.max(0, Math.min(items.length, prev - drop - reserve));
        // Remember how wide the header was when each item was dropped, so we
        // know when there is genuinely room to put it back.
        for (let i = next; i < prev; i++) droppedAtRef.current[i] = width;
        return next;
      }
      // Restoring cannot be driven from scrollWidth: it is defined to include
      // the padding box, so `clientWidth - scrollWidth` is never positive and
      // the old restore branch was unreachable — collapse was permanent for the
      // session. A transient squeeze (the agent-status badge, a long model name,
      // opening the sidebar) folded items forever.
      if (prev < items.length) {
        const droppedAt = droppedAtRef.current[prev];
        if (droppedAt === undefined || width >= droppedAt + ITEM_W + 8) {
          delete droppedAtRef.current[prev];
          return prev + 1;
        }
      }
      return prev;
    });
  }, [items.length]);

  useLayoutEffect(() => { measure(); }, [measure, visible, items.length]);

  useEffect(() => {
    const header = wrapRef.current?.closest('header');
    if (!header || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(() => measure());
    ro.observe(header);
    return () => ro.disconnect();
  }, [measure]);

  const inline = items.slice(0, visible);
  const overflow = items.slice(visible);

  const btnCls = (active?: boolean) =>
    `p-2 rounded-md transition-colors disabled:opacity-40 ${
      active
        ? (dark ? 'bg-blue-800 text-blue-300' : 'bg-blue-100 text-blue-700')
        : (dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600')
    }`;

  return (
    <div ref={wrapRef} className="flex items-center shrink-0">
      {children}
      {inline.map(it => (
        <button
          key={it.id}
          onClick={it.onSelect}
          title={it.label}
          aria-label={it.label}
          aria-pressed={it.active}
          disabled={it.disabled}
          className={btnCls(it.active)}
        >
          {it.icon}
        </button>
      ))}

      {overflow.length > 0 && (
        <>
          <button
            ref={moreRef}
            onClick={() => setMenuOpen(o => !o)}
            title={`More actions (${overflow.length})`}
            aria-label={`More actions (${overflow.length})`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="toolbar-overflow"
            className={`${btnCls(false)} shrink-0`}
          >
            ⋯
          </button>
          <AnchoredMenu
            anchorRef={moreRef}
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            dark={dark}
            align="right"
            ariaLabel="More toolbar actions"
            className="min-w-[14rem]"
          >
            {overflow.map(it => (
              <button
                key={it.id}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => { setMenuOpen(false); it.onSelect(); }}
                className={`w-full text-left text-xs px-3 py-1.5 flex items-center gap-2 transition-colors disabled:opacity-40 ${
                  dark ? 'text-zinc-300 hover:bg-zinc-700' : 'text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <span aria-hidden="true" className="w-4 text-center">{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {it.active && <span className={dark ? 'text-blue-400' : 'text-blue-600'}>●</span>}
              </button>
            ))}
          </AnchoredMenu>
        </>
      )}
    </div>
  );
};

export default ToolbarActions;
