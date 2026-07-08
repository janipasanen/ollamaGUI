/**
 * Format a message timestamp for display (#253).
 *
 * Same-day messages show a compact 24-hour clock (e.g. "14:32"); older
 * messages show a short month-day + time (e.g. "Mar 5, 09:10"). Returns an
 * empty string for invalid timestamps.
 */
export function formatMessageTime(ts: number | undefined, now: number = Date.now()): string {
  if (!ts || !Number.isFinite(ts)) return '';
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
