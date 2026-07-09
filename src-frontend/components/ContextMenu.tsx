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

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Message actions"
      data-testid="message-context-menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 60 }}
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
