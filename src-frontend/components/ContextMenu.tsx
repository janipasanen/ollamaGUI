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

  // Focus the first enabled item on open and support ArrowUp/Down/Home/End
  // navigation between items (#452).
  React.useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    first?.focus();
  }, []);

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
