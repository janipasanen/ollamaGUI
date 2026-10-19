/**
 * Scheduled runs panel (#671): add / toggle / delete and the last-run summary.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SchedulePanel from '../components/SchedulePanel';
import { newScheduleEntry, type ScheduleEntry } from '../services/scheduledRuns';

const entries: ScheduleEntry[] = [
  newScheduleEntry({ id: 'a', goal: 'keep the build green', intervalMinutes: 30 }),
  newScheduleEntry({
    id: 'b', goal: 'triage the inbox', kind: 'daily', time: '07:30', enabled: false,
    lastRunAt: new Date(2026, 4, 1, 7, 30).getTime(), lastVerdict: 'blocked',
    model: 'qwen2.5:1.5b',
  }),
];

describe('SchedulePanel', () => {
  it('lists entries with their schedule and state', () => {
    render(<SchedulePanel entries={entries} onChange={() => {}} models={[]} />);
    expect(screen.getByText('keep the build green')).toBeInTheDocument();
    expect(screen.getByText(/every 30 min/)).toBeInTheDocument();
    expect(screen.getByText(/daily at 07:30/)).toBeInTheDocument();
    expect(screen.getByText(/qwen2\.5:1\.5b/)).toBeInTheDocument();
    expect(screen.getByText(/⛔ blocked/)).toBeInTheDocument();
    expect(screen.getByText(/paused/)).toBeInTheDocument();
  });

  it('adds an interval entry with the typed goal', () => {
    const onChange = vi.fn();
    render(<SchedulePanel entries={[]} onChange={onChange} models={[]} />);
    expect(screen.getByTestId('schedule-empty')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('schedule-goal'), { target: { value: '  fix flaky tests ' } });
    fireEvent.change(screen.getByTestId('schedule-interval'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('schedule-add'));

    const next = onChange.mock.calls[0][0] as ScheduleEntry[];
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ goal: 'fix flaky tests', kind: 'interval', intervalMinutes: 15, enabled: true });
  });

  it('switches to a time field for daily schedules', () => {
    const onChange = vi.fn();
    render(<SchedulePanel entries={[]} onChange={onChange} models={[]} />);
    fireEvent.change(screen.getByTestId('schedule-kind'), { target: { value: 'weekdays' } });
    expect(screen.queryByTestId('schedule-interval')).toBeNull();

    fireEvent.change(screen.getByTestId('schedule-goal'), { target: { value: 'standup notes' } });
    fireEvent.change(screen.getByTestId('schedule-time'), { target: { value: '08:15' } });
    fireEvent.click(screen.getByTestId('schedule-add'));

    expect((onChange.mock.calls[0][0] as ScheduleEntry[])[0]).toMatchObject({
      goal: 'standup notes', kind: 'weekdays', time: '08:15',
    });
  });

  it('disables Add for an empty goal', () => {
    render(<SchedulePanel entries={[]} onChange={() => {}} models={[]} />);
    expect(screen.getByTestId('schedule-add')).toBeDisabled();
    fireEvent.change(screen.getByTestId('schedule-goal'), { target: { value: 'x' } });
    expect(screen.getByTestId('schedule-add')).toBeEnabled();
  });

  it('toggles and deletes an entry', () => {
    const onChange = vi.fn();
    render(<SchedulePanel entries={entries} onChange={onChange} models={[]} />);
    const toggles = screen.getAllByTestId('schedule-toggle');
    expect(toggles[0]).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggles[0]);
    expect((onChange.mock.calls[0][0] as ScheduleEntry[])[0].enabled).toBe(false);

    fireEvent.click(screen.getAllByTestId('schedule-delete')[1]);
    const afterDelete = onChange.mock.calls[1][0] as ScheduleEntry[];
    expect(afterDelete.map(e => e.id)).toEqual(['a']);
  });

  it('offers the model list when models are known', () => {
    render(<SchedulePanel entries={[]} onChange={() => {}} models={['llama3:8b', 'phi4:mini']} />);
    const select = screen.getByTestId('schedule-model');
    expect(select).toHaveTextContent('llama3:8b');
    expect(select).toHaveTextContent('current model');
  });
});
