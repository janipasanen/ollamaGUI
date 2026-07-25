import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { useState } from 'react';
import { useModalFocus } from '../components/useModalFocus';

function Harness() {
  const [open, setOpen] = useState(false);
  const ref = useModalFocus<HTMLDivElement>(open);
  return (
    <div>
      <button onClick={() => setOpen(true)}>trigger</button>
      {open && (
        <div ref={ref} tabIndex={-1} role="dialog" aria-label="test dialog">
          <button onClick={() => setOpen(false)}>first</button>
          <button>last</button>
        </div>
      )}
    </div>
  );
}

describe('useModalFocus (#447)', () => {
  it('moves focus into the dialog when it opens', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    const trigger = screen.getByText('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    act(() => { vi.runAllTimers(); });
    expect(document.activeElement).toBe(screen.getByText('first'));
    vi.useRealTimers();
  });

  it('traps Tab: forward from last wraps to first, Shift+Tab from first wraps to last', () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(screen.getByText('trigger'));
    act(() => { vi.runAllTimers(); });
    const first = screen.getByText('first');
    const last = screen.getByText('last');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    vi.useRealTimers();
  });

  it('restores focus to the trigger when the dialog closes', () => {
    vi.useFakeTimers();
    render(<Harness />);
    const trigger = screen.getByText('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    act(() => { vi.runAllTimers(); });
    fireEvent.click(screen.getByText('first')); // closes the dialog
    expect(document.activeElement).toBe(trigger);
    vi.useRealTimers();
  });
});
