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
