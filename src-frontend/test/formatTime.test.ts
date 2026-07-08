import { describe, it, expect } from 'vitest';
import { formatMessageTime } from '../services/formatTime';

const DAY = 86_400_000;

describe('formatMessageTime (#253/#260)', () => {
  it('returns empty string for undefined/invalid timestamps', () => {
    expect(formatMessageTime(undefined)).toBe('');
    expect(formatMessageTime(0)).toBe('');
    expect(formatMessageTime(NaN)).toBe('');
  });

  it('shows "just now" for messages under 1 minute old', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0).getTime();
    expect(formatMessageTime(now - 30_000, now)).toBe('just now');
    expect(formatMessageTime(now, now)).toBe('just now');
  });

  it('shows "Nm ago" for messages under 1 hour old', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0).getTime();
    expect(formatMessageTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatMessageTime(now - 59 * 60_000, now)).toBe('59m ago');
  });

  it('shows "Nh ago" for messages under 24 hours old', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0).getTime();
    expect(formatMessageTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatMessageTime(now - 23 * 3_600_000, now)).toBe('23h ago');
  });

  it('falls back to "Mon D, HH:MM" for messages older than 24 hours', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0).getTime();
    const ts = new Date(2026, 1, 28, 9, 10, 0).getTime();
    expect(formatMessageTime(ts, now)).toBe('Feb 28, 09:10');
  });

  it('falls back to absolute for future-dated timestamps (clock skew)', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0).getTime();
    const future = new Date(2026, 2, 5, 14, 32, 0).getTime();
    expect(formatMessageTime(future, now)).toBe('14:32');
  });

  it('uses the short-date format when the day differs but is within 24h edge (just over)', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0).getTime();
    // 25h ago -> crosses the 24h relative boundary into absolute
    const ts = now - 25 * 3_600_000;
    const expected = new Date(ts);
    const hh = String(expected.getHours()).padStart(2, '0');
    const mm = String(expected.getMinutes()).padStart(2, '0');
    const month = expected.toLocaleString('en-US', { month: 'short' });
    expect(formatMessageTime(ts, now)).toBe(`${month} ${expected.getDate()}, ${hh}:${mm}`);
  });

  it('just-now boundary: 59s -> just now, 61s -> 1m ago', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0).getTime();
    expect(formatMessageTime(now - 59_000, now)).toBe('just now');
    expect(formatMessageTime(now - 61_000, now)).toBe('1m ago');
  });

  it('24h boundary: just under -> 23h ago, just over -> absolute', () => {
    const now = new Date(2026, 2, 5, 10, 0, 0).getTime();
    expect(formatMessageTime(now - (DAY - 60_000), now)).toBe('23h ago');
    // exactly 24h+ -> absolute (different day)
    const ts = now - DAY - 60_000;
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const month = d.toLocaleString('en-US', { month: 'short' });
    expect(formatMessageTime(ts, now)).toBe(`${month} ${d.getDate()}, ${hh}:${mm}`);
  });
});
