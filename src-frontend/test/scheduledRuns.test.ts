/**
 * Scheduled runs (#671): wall-clock math, one-shot firing, overlap policy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  nextRunAt, describeSchedule, newScheduleEntry, startScheduler, loadSchedules,
  saveSchedules, SCHEDULES_KEY, MAX_TIMER_MS,
  type ScheduleEntry, type RunVerdict,
} from '../services/scheduledRuns';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);
const entry = (partial: Partial<ScheduleEntry>) => ({
  ...newScheduleEntry({ goal: 'fix the build', createdAt: at(2026, 5, 1, 9, 0).getTime() }),
  ...partial,
});

describe('nextRunAt — interval', () => {
  it('uses createdAt for the first slot, not "now"', () => {
    const e = entry({ intervalMinutes: 60 });
    expect(nextRunAt(e, at(2026, 5, 1, 10, 0))).toEqual(at(2026, 5, 1, 10, 0));
  });

  it('jumps over missed slots instead of replaying them', () => {
    const e = entry({ intervalMinutes: 30 });
    // Created 09:00, app opens 12:10 → the next slot is 12:30, not five runs.
    expect(nextRunAt(e, at(2026, 5, 1, 12, 10))).toEqual(at(2026, 5, 1, 12, 30));
  });

  it('counts from the last run', () => {
    const e = entry({ intervalMinutes: 15, lastRunAt: at(2026, 5, 1, 11, 5).getTime() });
    expect(nextRunAt(e, at(2026, 5, 1, 11, 10))).toEqual(at(2026, 5, 1, 11, 20));
  });

  it('clamps a sub-minute interval to one minute', () => {
    const e = entry({ intervalMinutes: 0.2 });
    expect(nextRunAt(e, at(2026, 5, 1, 9, 0))).toEqual(at(2026, 5, 1, 9, 1));
  });
});

describe('nextRunAt — daily and weekdays', () => {
  it('returns today when the time is still ahead', () => {
    const e = entry({ kind: 'daily', time: '17:30' });
    expect(nextRunAt(e, at(2026, 5, 1, 9, 0))).toEqual(at(2026, 5, 1, 17, 30));
  });

  it('returns tomorrow when the time has passed', () => {
    const e = entry({ kind: 'daily', time: '07:00' });
    expect(nextRunAt(e, at(2026, 5, 1, 9, 0))).toEqual(at(2026, 5, 2, 7, 0));
  });

  it('skips the weekend for weekdays', () => {
    // 2026-05-01 is a Friday; the next weekday slot after Friday 18:00 is Monday.
    const e = entry({ kind: 'weekdays', time: '08:00' });
    expect(nextRunAt(e, at(2026, 5, 1, 18, 0))).toEqual(at(2026, 5, 4, 8, 0));
  });

  it('lands on the same wall-clock time across a DST change', () => {
    // Europe/Stockholm springs forward on 2026-03-29; 09:00 stays 09:00 local.
    const e = entry({ kind: 'daily', time: '09:00' });
    const next = nextRunAt(e, at(2026, 3, 28, 12, 0))!;
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  it('refuses an unusable time', () => {
    expect(nextRunAt(entry({ kind: 'daily', time: '25:00' }), at(2026, 5, 1))).toBeNull();
    expect(nextRunAt(entry({ kind: 'daily', time: 'noon' }), at(2026, 5, 1))).toBeNull();
  });
});

describe('nextRunAt — eligibility', () => {
  it('never fires a disabled entry', () => {
    expect(nextRunAt(entry({ enabled: false, intervalMinutes: 5 }), at(2026, 5, 1, 10, 0))).toBeNull();
  });

  it('never fires an entry without a goal', () => {
    expect(nextRunAt(entry({ goal: '   ' }), at(2026, 5, 1, 10, 0))).toBeNull();
  });
});

describe('describeSchedule', () => {
  it('renders each kind', () => {
    expect(describeSchedule(entry({ intervalMinutes: 30 }))).toBe('every 30 min');
    expect(describeSchedule(entry({ intervalMinutes: 120 }))).toBe('every 2 h');
    expect(describeSchedule(entry({ kind: 'daily', time: '09:00' }))).toBe('daily at 09:00');
    expect(describeSchedule(entry({ kind: 'weekdays', time: '08:15' }))).toBe('weekdays at 08:15');
  });
});

describe('startScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 5, 1, 9, 30));
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  function harness(entries: ScheduleEntry[], onFire: (e: ScheduleEntry) => Promise<RunVerdict | void>) {
    const state = { entries: entries.map(e => ({ ...e })) };
    const fires: string[] = [];
    const scheduler = startScheduler({
      getEntries: () => state.entries,
      onFire: async e => { fires.push(e.id); return onFire(e); },
      onChange: next => { state.entries = next; saveSchedules(next); },
    });
    return { state, fires, scheduler };
  }

  it('fires once at the slot, stores the verdict, then arms the next slot', async () => {
    const e = entry({ id: 'a', intervalMinutes: 60 });
    const { state, fires } = harness([e], async () => 'done');

    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(fires).toEqual([]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fires).toEqual(['a']);
    expect(state.entries[0].lastRunAt).toBe(at(2026, 5, 1, 10, 0).getTime());
    expect(state.entries[0].lastVerdict).toBe('done');

    // The next slot is 11:00, so nothing fires at 10:30.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fires).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fires).toEqual(['a', 'a']);
  });

  it('skips a slot that arrives while the previous run is still going', async () => {
    const e = entry({ id: 'slow', intervalMinutes: 30 });
    let release: (v: RunVerdict) => void = () => {};
    const { state, fires } = harness([e], () => new Promise<RunVerdict>(r => { release = r; }));

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fires).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30 * 60_000); // second slot, still running
    expect(fires).toHaveLength(1);
    expect(state.entries[0].lastSkippedAt).toBe(at(2026, 5, 1, 10, 30).getTime());

    release('done');
    await vi.advanceTimersByTimeAsync(0);
    expect(state.entries[0].lastVerdict).toBe('done');
  });

  it('records a failed run as an error verdict', async () => {
    const { state } = harness([entry({ id: 'boom', intervalMinutes: 1 })], async () => { throw new Error('x'); });
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.entries[0].lastVerdict).toBe('error');
  });

  it('ignores disabled entries', async () => {
    const { fires } = harness([entry({ id: 'off', enabled: false, intervalMinutes: 1 })], async () => 'done');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fires).toEqual([]);
  });

  it('does not replay slots missed while the app was closed', async () => {
    const e = entry({ id: 'old', intervalMinutes: 60, createdAt: at(2026, 5, 1, 1, 0).getTime() });
    const { fires } = harness([e], async () => 'done');
    // 09:30 now: the next slot is 10:00, not the eight that were missed.
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(fires).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fires).toEqual(['old']);
  });

  it('picks the soonest of several entries', async () => {
    const { fires } = harness(
      [entry({ id: 'later', intervalMinutes: 60 }), entry({ id: 'sooner', intervalMinutes: 10 })],
      async () => 'done',
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fires[0]).toBe('sooner');
    expect(fires).not.toContain('later');
  });

  it('arms exactly one timer for the distance to the slot', async () => {
    const delays: number[] = [];
    const scheduler = startScheduler({
      getEntries: () => [entry({ id: 'a', intervalMinutes: 45 })],
      onFire: async () => 'done',
      setTimer: (_fn, ms) => { delays.push(ms); return delays.length; },
      clearTimer: () => {},
    });
    // 09:30 now, created 09:00, every 45 min → 09:45.
    expect(delays).toEqual([15 * 60_000]);
    scheduler.stop();
    expect(MAX_TIMER_MS).toBeGreaterThan(24 * 60 * 60_000);
  });

  it('stops firing after stop()', async () => {
    const { fires, scheduler } = harness([entry({ id: 'a', intervalMinutes: 5 })], async () => 'done');
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fires).toEqual([]);
  });
});

describe('persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips entries', () => {
    const e = entry({ id: 'p', goal: 'ship it', kind: 'weekdays', time: '08:15' });
    saveSchedules([e]);
    expect(loadSchedules()).toEqual([e]);
  });

  it('ignores a malformed store', () => {
    localStorage.setItem(SCHEDULES_KEY, '{not json');
    expect(loadSchedules()).toEqual([]);
    localStorage.setItem(SCHEDULES_KEY, JSON.stringify({ nope: true }));
    expect(loadSchedules()).toEqual([]);
  });
});
