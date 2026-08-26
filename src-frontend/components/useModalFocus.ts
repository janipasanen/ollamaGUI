/**
 * Shared modal focus management (#447).
 *
 * For an open dialog:
 *  - moves focus to the first focusable element inside (or the container),
 *  - traps Tab / Shift+Tab within the dialog,
 *  - restores focus to the previously-focused trigger when it closes.
 *
 * Usage:
 *   const ref = useModalFocus<HTMLDivElement>(isOpen);
 *   ...
 *   {isOpen && <div ref={ref} tabIndex={-1} role="dialog" ...>...</div>}
 */

import { useEffect, useRef, useRef as useMutableRef } from 'react';
import type { MutableRefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalFocus<T extends HTMLElement>(open: boolean): MutableRefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;

    // Focus the first focusable child (or the container itself). Deferred a
    // tick so the dialog subtree is mounted.
    const focusTimer = setTimeout(() => {
      const el = containerRef.current;
      if (!el) return;
      const first = el.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el).focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const c = containerRef.current;
      if (!c) return;
      const items = Array.from(c.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) { e.preventDefault(); c.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && c.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) { e.preventDefault(); last.focus(); }
      } else {
        if (!inside || active === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey, true);
      // Restore focus to the trigger (if it is still in the document).
      const r = restoreRef.current;
      if (r && document.contains(r)) r.focus();
    };
  }, [open]);

  return containerRef;
}
