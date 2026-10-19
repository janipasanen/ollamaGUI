/**
 * Settings → Scheduled runs (#671).
 *
 * A list of goals with a "when". The timer itself lives in App; this panel only
 * edits and displays entries.
 */
import { useState } from 'react';
import {
  describeSchedule, newScheduleEntry, nextRunAt,
  type ScheduleEntry, type ScheduleKind,
} from '../services/scheduledRuns';

interface Props {
  entries: ScheduleEntry[];
  onChange: (next: ScheduleEntry[]) => void;
  /** Installed + connected model names, for the optional model picker. */
  models: string[];
}

const VERDICT_LABEL: Record<string, string> = {
  done: '✅ done',
  blocked: '⛔ blocked',
  continue: '↩︎ continue',
  error: '⚠️ error',
};

function when(entry: ScheduleEntry): string {
  const at = nextRunAt(entry);
  if (!at) return entry.enabled ? 'never' : 'paused';
  const diff = at.getTime() - Date.now();
  if (diff < 60_000) return 'in under a minute';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  return at.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function SchedulePanel({ entries, onChange, models }: Props) {
  const [goal, setGoal] = useState('');
  const [kind, setKind] = useState<ScheduleKind>('interval');
  const [interval, setIntervalMinutes] = useState('60');
  const [time, setTime] = useState('09:00');
  const [model, setModel] = useState('');

  const add = () => {
    if (!goal.trim()) return;
    const entry = newScheduleEntry({
      goal: goal.trim(),
      kind,
      model,
      intervalMinutes: Math.max(1, Number(interval) || 60),
      time,
    });
    onChange([...entries, entry]);
    setGoal('');
  };

  const update = (id: string, patch: Partial<ScheduleEntry>) =>
    onChange(entries.map(e => (e.id === id ? { ...e, ...patch } : e)));
  const remove = (id: string) => onChange(entries.filter(e => e.id !== id));

  return (
    <div className="settings-section" data-testid="schedule-panel">
      <h3>Scheduled runs</h3>
      <p className="settings-hint">
        Runs while the app is open. A run that is still going when its next slot
        arrives is skipped, and slots missed while the app was closed are not
        replayed.
      </p>

      <div className="schedule-form">
        <input
          data-testid="schedule-goal"
          aria-label="Scheduled goal"
          placeholder="Goal, e.g. keep the build green"
          value={goal}
          onChange={e => setGoal(e.target.value)}
        />
        <select
          data-testid="schedule-kind"
          aria-label="Schedule kind"
          value={kind}
          onChange={e => setKind(e.target.value as ScheduleKind)}
        >
          <option value="interval">Every…</option>
          <option value="daily">Daily at…</option>
          <option value="weekdays">Weekdays at…</option>
        </select>
        {kind === 'interval' ? (
          <input
            data-testid="schedule-interval"
            aria-label="Interval in minutes"
            type="number"
            min={1}
            value={interval}
            onChange={e => setIntervalMinutes(e.target.value)}
          />
        ) : (
          <input
            data-testid="schedule-time"
            aria-label="Time of day"
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
          />
        )}
        {models.length > 0 && (
          <select
            data-testid="schedule-model"
            aria-label="Model for scheduled runs"
            value={model}
            onChange={e => setModel(e.target.value)}
          >
            <option value="">current model</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        <button type="button" data-testid="schedule-add" onClick={add} disabled={!goal.trim()}>
          Add
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="settings-hint" data-testid="schedule-empty">No scheduled runs.</p>
      ) : (
        <ul className="schedule-list">
          {entries.map(entry => (
            <li key={entry.id} data-testid="schedule-entry">
              <div className="schedule-main">
                <strong>{entry.goal}</strong>
                <span className="schedule-meta">
                  {describeSchedule(entry)}
                  {entry.model ? ` · ${entry.model}` : ''}
                  {entry.enabled ? ` · ${when(entry)}` : ' · paused'}
                </span>
                {entry.lastRunAt && (
                  <span className="schedule-meta" data-testid="schedule-last">
                    last {new Date(entry.lastRunAt).toLocaleString()}
                    {entry.lastVerdict ? ` · ${VERDICT_LABEL[entry.lastVerdict] ?? entry.lastVerdict}` : ''}
                    {entry.lastSkippedAt ? ' · skipped a slot while running' : ''}
                  </span>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={entry.enabled}
                aria-label={`Enable ${entry.goal}`}
                data-testid="schedule-toggle"
                onClick={() => update(entry.id, { enabled: !entry.enabled })}
              >
                {entry.enabled ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                data-testid="schedule-delete"
                aria-label={`Delete ${entry.goal}`}
                onClick={() => remove(entry.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
