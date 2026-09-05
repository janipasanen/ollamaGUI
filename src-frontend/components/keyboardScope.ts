/**
 * Guards for window-level keyboard shortcuts (#497, #498).
 *
 * Modals registered Enter on `window` with no notion of where focus actually
 * was. The chat composer is a <textarea>, and opening a modal does not by
 * itself move focus out of it — so pressing Enter to send a message instead
 * confirmed whatever modal happened to be open (accepting a file edit,
 * approving a plan), and in the plan modal it also discarded pending edits.
 */

/** True when focus is in a field where Enter/Escape belong to the field. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    // Checkboxes/radios/buttons do not consume Enter as text entry.
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file'].includes(type);
  }
  return false;
}

/**
 * True when a window-level Enter shortcut should be ignored: the user is typing,
 * or focus is on a button/link that has its own activation behaviour.
 */
export function shouldIgnoreEnterShortcut(el: EventTarget | null): boolean {
  if (isTypingTarget(el)) return true;
  return el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement;
}
