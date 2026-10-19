/**
 * Scheduled runs (#671).
 *
 * A schedule is a goal plus "when": every N minutes, daily at HH:MM, or on
 * weekdays at HH:MM. Wall-clock arithmetic is deliberately local-time based, so
 * a `daily 09:00` entry stays at 09:00 across a DST change instead of drifting an
 * hour.
 *
 * The scheduler arms exactly one timer for the next due entry; it does not poll.
 */

export type ScheduleKind = 'interval' | 'daily' | 'weekdays';

export type RunVerdict = 'done' | 'blocked' | 'continue' | 'error';

export interface ScheduleEntry {
  id: string;
  goal: string;
  /** Empty = whatever the app's selected model is. */
  model: string;
  judgeModel?: string;
  workspace?: string;
  kind: ScheduleKind;
  /** interval only, in minutes (minimum 1). */
  intervalMinutes?: number;
  /** daily/weekdays only, "HH:MM" local time. */
  time?: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastVerdict?: RunVerdict;
  /** Set when a slot arrived while the previous run was still going. */
  lastSkippedAt?: number;
}

export const SCHEDULES_KEY = 'ollama_gui_schedules';
export const MIN_INTERVAL_MINUTES = 1;
/** setTimeout clamps anything above 2^31-1 ms, so arm in slices for far slots. */
export const MAX_TIMER_MS = 2 ** 31 - 1;
/** A slot that arrived within this window past `now` still counts as due. */
const DUE_EPSILON_MS = 1_000;

export function newScheduleEntry(partial: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    id: `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    goal: '',
    model: '',
    kind: 'interval',
    intervalMinutes: 60,
    enabled: true,
    createdAt: Date.now(),
    ...partial,
  };
}

function parseTime(time: string | undefined): { h: number; m: number } | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

function atLocal(day: Date, h: number, m: number): Date {
  // Local constructor fields, so DST transitions keep the wall-clock time.
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
}

/**
 * The next time this entry should run, strictly after `from`.
 * Returns null for an entry that can never run (disabled, bad config, empty goal).
 */
export function nextRunAt(entry: ScheduleEntry, from: Date = new Date()): Date | null {
  if (!entry.enabled || !entry.goal.trim()) return null;
  const fromMs = from.getTime();

  if (entry.kind === 'interval') {
    const minutes = Math.max(MIN_INTERVAL_MINUTES, Math.round(entry.intervalMinutes ?? 60));
    const step = minutes * 60_000;
    const base = entry.lastRunAt ?? entry.lastSkippedAt ?? entry.createdAt;
    if (base + step >= fromMs) return new Date(base + step);
    // Missed slots are not replayed: jump past them to the next future slot
    // instead of returning one in the past and firing a burst on launch.
    const skipped = Math.floor((fromMs - base) / step) + 1;
    return new Date(base + skipped * step);
  }

  const parsed = parseTime(entry.time);
  if (!parsed) return null;

  let candidate = atLocal(from, parsed.h, parsed.m);
  if (candidate.getTime() <= fromMs) {
    candidate = new Date(candidate.getTime());
    candidate.setDate(candidate.getDate() + 1);
    candidate = atLocal(candidate, parsed.h, parsed.m);
  }
  if (entry.kind === 'weekdays') {
    // 0 = Sunday, 6 = Saturday.
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 1);
      candidate = atLocal(candidate, parsed.h, parsed.m);
    }
  }
  return candidate;
}

/** Human-readable schedule, e.g. "every 30 min", "daily at 09:00". */
export function describeSchedule(entry: ScheduleEntry): string {
  if (entry.kind === 'interval') {
    const minutes = Math.max(MIN_INTERVAL_MINUTES, Math.round(entry.intervalMinutes ?? 60));
    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      return `every ${hours} h`;
    }
    return `every ${minutes} min`;
  }
  const time = entry.time ?? '00:00';
  return entry.kind === 'daily' ? `daily at ${time}` : `weekdays at ${time}`;
}

export function loadSchedules(): ScheduleEntry[] {
  try {
    const raw = localStorage.getItem(SCHEDULES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is ScheduleEntry =>
      !!e && typeof e.id === 'string' && typeof e.goal === 'string' && typeof e.createdAt === 'number');
  } catch {
    return [];
  }
}

export function saveSchedules(entries: ScheduleEntry[]): void {
  try {
    localStorage.setItem(SCHEDULES_KEY, JSON.stringify(entries));
  } catch {
    /* storage full or unavailable: the in-memory list still works this session */
  }
}

export interface SchedulerOptions {
  /** Read the current list every tick; entries may change while the timer waits. */
  getEntries: () => ScheduleEntry[];
  /** Start a run. Resolves when the run (and its judge) finished. */
  onFire: (entry: ScheduleEntry) => Promise<RunVerdict | void>;
  /** Persist a change made by the scheduler itself (lastRunAt, verdict, skip). */
  onChange?: (entries: ScheduleEntry[]) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Scheduler {
  /** Re-arm after the entry list changed. */
  refresh: () => void;
  stop: () => void;
  /** Exposed for tests: run the due-check now. */
  tick: () => Promise<void>;
}

/**
 * Arm one timer for the earliest next slot.
 *
 * Runs never overlap: a slot that arrives while the previous run is still
 * going is recorded as skipped and the entry waits for the following slot.
 */
export function startScheduler(options: SchedulerOptions): Scheduler {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const running = new Set<string>();
  let handle: unknown = null;
  let stopped = false;

  const commit = (entries: ScheduleEntry[]) => options.onChange?.(entries);

  function arm(): void {
    if (stopped) return;
    if (handle !== null) { clearTimer(handle); handle = null; }
    const from = new Date(now());
    let soonest: { entry: ScheduleEntry; at: Date } | null = null;
    for (const entry of options.getEntries()) {
      const at = nextRunAt(entry, from);
      if (!at) continue;
      if (!soonest || at.getTime() < soonest.at.getTime()) soonest = { entry, at };
    }
    if (!soonest) return;
    const delay = Math.max(0, Math.min(MAX_TIMER_MS, soonest.at.getTime() - from.getTime()));
    handle = setTimer(() => { void tick(); }, delay);
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    handle = null;
    const time = now();
    const entries = options.getEntries();
    // Look back one second: the slot that just arrived must count as due even
    // though nextRunAt() only answers "strictly after".
    const due = entries.filter(entry => {
      if (!entry.enabled || !entry.goal.trim()) return false;
      const at = nextRunAt(entry, new Date(time - DUE_EPSILON_MS));
      return at !== null && at.getTime() <= time;
    });

    for (const entry of due) {
      if (running.has(entry.id)) {
        entry.lastSkippedAt = time;
        commit(entries);
        continue;
      }
      running.add(entry.id);
      entry.lastRunAt = time;
      commit(entries);
      // Do not await: a slow run must not delay arming the next slot, or an
      // entry that runs longer than its interval would never see the following
      // tick and could never be recorded as skipped.
      void Promise.resolve()
        .then(() => options.onFire(entry))
        .then(verdict => { if (verdict) { entry.lastVerdict = verdict; commit(entries); } })
        .catch(() => { entry.lastVerdict = 'error'; commit(entries); })
        .finally(() => { running.delete(entry.id); });
    }
    arm();
  }

  arm();
  return {
    refresh: () => { if (!stopped) arm(); },
    stop: () => { stopped = true; if (handle !== null) { clearTimer(handle); handle = null; } },
    tick,
  };
}
