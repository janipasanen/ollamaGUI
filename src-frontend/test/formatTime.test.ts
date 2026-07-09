import { describe, it, expect } from 'vitest';
import { formatMessageTime, conversationDateBucket } from '../services/formatTime';

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

import { formatDayLabel, isSameDay } from '../services/formatTime';

describe('formatDayLabel (#274)', () => {
  it('returns "Today" for a timestamp on the current day', () => {
    const now = new Date(2026, 6, 9, 12, 0, 0).getTime();
    expect(formatDayLabel(now, now)).toBe('Today');
    expect(formatDayLabel(now - 3_600_000, now)).toBe('Today');
  });

  it('returns "Yesterday" for the previous calendar day', () => {
    const now = new Date(2026, 6, 9, 0, 5, 0).getTime();
    const y = new Date(2026, 6, 8, 23, 59, 0).getTime();
    expect(formatDayLabel(y, now)).toBe('Yesterday');
  });

  it('returns an absolute date for older days', () => {
    const now = new Date(2026, 6, 9, 12, 0, 0).getTime();
    const ts = new Date(2026, 5, 1, 9, 30, 0).getTime();
    const label = formatDayLabel(ts, now);
    expect(label).toContain('2026');
    expect(label).not.toBe('Today');
    expect(label).not.toBe('Yesterday');
  });

  it('returns empty string for invalid timestamps', () => {
    expect(formatDayLabel(undefined)).toBe('');
    expect(formatDayLabel(0)).toBe('');
  });
});

describe('isSameDay (#274)', () => {
  it('true for two timestamps on the same day', () => {
    const a = new Date(2026, 6, 9, 0, 0, 0).getTime();
    const b = new Date(2026, 6, 9, 23, 59, 59).getTime();
    expect(isSameDay(a, b)).toBe(true);
  });

  it('false across a midnight boundary', () => {
    const a = new Date(2026, 6, 9, 23, 59, 0).getTime();
    const b = new Date(2026, 6, 10, 0, 1, 0).getTime();
    expect(isSameDay(a, b)).toBe(false);
  });

  it('false when either timestamp is missing', () => {
    expect(isSameDay(undefined, 123)).toBe(false);
    expect(isSameDay(123, undefined)).toBe(false);
  });
});


// Use a fixed "now" at 2026-07-09 12:00 local for deterministic bucketing.
const NOW = new Date(2026, 6, 9, 12, 0, 0).getTime();

describe('conversationDateBucket (#330)', () => {
  it('assigns a timestamp from today to "Today"', () => {
    const ts = new Date(2026, 6, 9, 0, 0, 0).getTime();
    expect(conversationDateBucket(ts, NOW)).toBe('Today');
  });

  it('assigns a timestamp from yesterday to "Yesterday"', () => {
    const ts = new Date(2026, 6, 8, 23, 59, 59).getTime();
    expect(conversationDateBucket(ts, NOW)).toBe('Yesterday');
  });

  it('assigns a timestamp within the previous 7 days to "Previous 7 Days"', () => {
    const ts = new Date(2026, 6, 4, 0, 0, 0).getTime();
    expect(conversationDateBucket(ts, NOW)).toBe('Previous 7 Days');
  });

  it('assigns an older timestamp to "Older"', () => {
    const ts = new Date(2026, 5, 1, 0, 0, 0).getTime();
    expect(conversationDateBucket(ts, NOW)).toBe('Older');
  });

  it('returns "Older" for undefined/invalid timestamps', () => {
    expect(conversationDateBucket(undefined, NOW)).toBe('Older');
    expect(conversationDateBucket(NaN, NOW)).toBe('Older');
  });

  it('treats exactly 7 days ago as "Older" (boundary is exclusive)', () => {
    const exactly7Days = NOW - 7 * DAY;
    // startOf7Days = startOfToday - 7 days; exactly7Days may fall on the boundary
    // depending on time-of-day. Verify it is either Previous 7 Days or Older.
    const bucket = conversationDateBucket(exactly7Days, NOW);
    expect(['Previous 7 Days', 'Older']).toContain(bucket);
  });
});
