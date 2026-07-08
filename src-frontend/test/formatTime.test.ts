import { describe, it, expect } from 'vitest';
import { formatMessageTime } from '../services/formatTime';

describe('formatMessageTime (#253)', () => {
  it('returns empty string for undefined/invalid timestamps', () => {
    expect(formatMessageTime(undefined)).toBe('');
    expect(formatMessageTime(0)).toBe('');
    expect(formatMessageTime(NaN)).toBe('');
  });

  it('shows HH:MM for same-day timestamps', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0).getTime();
    const ts = new Date(2026, 2, 5, 14, 32, 0).getTime();
    expect(formatMessageTime(ts, now)).toBe('14:32');
  });

  it('shows "Mon D, HH:MM" for older timestamps', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0).getTime();
    const ts = new Date(2026, 1, 28, 9, 10, 0).getTime();
    expect(formatMessageTime(ts, now)).toBe('Feb 28, 09:10');
  });

  it('treats midnight as same-day boundary correctly', () => {
    const now = new Date(2026, 2, 5, 0, 5, 0).getTime();
    const ts = new Date(2026, 2, 5, 23, 59, 0).getTime();
    expect(formatMessageTime(ts, now)).toBe('23:59');
  });

  it('shows the short-date format when the day differs even within the same month', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0).getTime();
    const ts = new Date(2026, 2, 4, 9, 10, 0).getTime();
    expect(formatMessageTime(ts, now)).toBe('Mar 4, 09:10');
  });
});
