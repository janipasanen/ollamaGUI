/**
 * Format a message timestamp for display (#253 / #260).
 *
 * Recent messages show a relative label ("just now", "5m ago", "3h ago" for
 * <24h); older messages fall back to a compact clock — same-day "HH:MM",
 * otherwise "Mon D, HH:MM". Returns an empty string for invalid timestamps.
 */
export function formatMessageTime(ts: number | undefined, now: number = Date.now()): string {
  if (!ts || !Number.isFinite(ts)) return '';
  const diff = now - ts;
  if (diff < 0) {
    // future-dated (clock skew) — fall through to absolute
  } else if (diff < 60_000) {
    return 'just now';
  } else if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  } else if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }

  const date = new Date(ts);
  const cur = new Date(now);
  const sameDay = date.getFullYear() === cur.getFullYear()
    && date.getMonth() === cur.getMonth()
    && date.getDate() === cur.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  const month = date.toLocaleString('en-US', { month: 'short' });
  return `${month} ${date.getDate()}, ${hh}:${mm}`;
}

/**
 * Format a day label for a date separator between messages (#274).
 * Returns "Today", "Yesterday" or a compact absolute date ("Mon D, YYYY").
 * Returns an empty string for invalid timestamps.
 */
export function formatDayLabel(ts: number | undefined, now: number = Date.now()): string {
  if (!ts || !Number.isFinite(ts)) return '';
  const date = new Date(ts);
  const cur = new Date(now);
  const sameDay = date.getFullYear() === cur.getFullYear()
    && date.getMonth() === cur.getMonth()
    && date.getDate() === cur.getDate();
  if (sameDay) return 'Today';
  const yesterday = new Date(cur);
  yesterday.setDate(cur.getDate() - 1);
  const isYesterday = date.getFullYear() === yesterday.getFullYear()
    && date.getMonth() === yesterday.getMonth()
    && date.getDate() === yesterday.getDate();
  if (isYesterday) return 'Yesterday';
  const month = date.toLocaleString('en-US', { month: 'short' });
  return `${month} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Whether two timestamps fall on the same calendar day. */
export function isSameDay(a: number | undefined, b: number | undefined): boolean {
  if (!a || !b || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

// ─── Conversation-list date buckets (#330) ───────────────────────────────────

export type DateBucket = 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Older';

/**
 * Assign a conversation to a date bucket for sidebar grouping (#330).
 * Mirrors ChatGPT's grouping: Today, Yesterday, Previous 7 Days, Older.
 */
export function conversationDateBucket(createdAt: number | undefined, now: number = Date.now()): DateBucket {
  if (!createdAt || !Number.isFinite(createdAt)) return 'Older';
  const cur = new Date(now);
  cur.setHours(0, 0, 0, 0);
  const startOfToday = cur.getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOf7Days = startOfToday - 7 * 86_400_000;
  if (createdAt >= startOfToday) return 'Today';
  if (createdAt >= startOfYesterday) return 'Yesterday';
  if (createdAt >= startOf7Days) return 'Previous 7 Days';
  return 'Older';
}
