/**
 * Goal mode UI (#668): the settings card persists the goal and judge choice,
 * and the goal stays visible above the composer while it applies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { GoalPanel, loadGoalSettings, saveGoalSettings, GOAL_KEY, GOAL_JUDGE_ENABLED_KEY, GOAL_JUDGE_MODEL_KEY } from '../components/GoalPanel';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe('GoalPanel', () => {
  it('persists the goal text as it is typed', () => {
    const onChange = vi.fn();
    render(<GoalPanel dark models={['llama3']} settings={{ goal: '', judgeEnabled: false, judgeModel: '' }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('goal-input'), { target: { value: 'make the suite green' } });
    expect(onChange).toHaveBeenCalledWith({ goal: 'make the suite green', judgeEnabled: false, judgeModel: '' });
  });

  it('hides the judge model picker until judge checkpoints are on', () => {
    const { rerender } = render(
      <GoalPanel dark models={['llama3']} settings={{ goal: 'g', judgeEnabled: false, judgeModel: '' }} onChange={() => {}} />,
    );
    expect(screen.queryByTestId('judge-model')).toBeNull();
    rerender(<GoalPanel dark models={['llama3']} settings={{ goal: 'g', judgeEnabled: true, judgeModel: '' }} onChange={() => {}} />);
    expect(screen.getByTestId('judge-model')).toBeInTheDocument();
  });

  it('offers every installed model as a judge, plus a "chat model" default', () => {
    render(<GoalPanel dark models={['llama3', 'qwen2.5:1.5b']} settings={{ goal: 'g', judgeEnabled: true, judgeModel: '' }} onChange={() => {}} />);
    const select = screen.getByTestId('judge-model') as HTMLSelectElement;
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toEqual(['', 'llama3', 'qwen2.5:1.5b']);
    expect(select.value).toBe('');
  });

  it('toggles judge checkpoints through the switch', () => {
    const onChange = vi.fn();
    render(<GoalPanel dark models={[]} settings={{ goal: 'g', judgeEnabled: false, judgeModel: '' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Judge checkpoints' }));
    expect(onChange).toHaveBeenCalledWith({ goal: 'g', judgeEnabled: true, judgeModel: '' });
  });
});

describe('goal settings persistence', () => {
  it('round-trips through localStorage', () => {
    saveGoalSettings({ goal: 'ship it', judgeEnabled: true, judgeModel: 'qwen2.5:1.5b' });
    expect(localStorage.getItem(GOAL_KEY)).toBe('ship it');
    expect(localStorage.getItem(GOAL_JUDGE_ENABLED_KEY)).toBe('true');
    expect(localStorage.getItem(GOAL_JUDGE_MODEL_KEY)).toBe('qwen2.5:1.5b');
    expect(loadGoalSettings()).toEqual({ goal: 'ship it', judgeEnabled: true, judgeModel: 'qwen2.5:1.5b' });
  });

  it('defaults to no goal and no judge', () => {
    expect(loadGoalSettings()).toEqual({ goal: '', judgeEnabled: false, judgeModel: '' });
  });

  it('survives storage being unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadGoalSettings()).toEqual({ goal: '', judgeEnabled: false, judgeModel: '' });
    spy.mockRestore();
  });
});

describe('goal banner (App integration)', () => {
  it('is shown from the stored goal and can be cleared', async () => {
    localStorage.setItem(GOAL_KEY, 'fix the login test');
    const App = (await import('../App')).default;
    render(<App />);

    const banner = await screen.findByTestId('goal-banner');
    expect(banner.textContent).toContain('fix the login test');

    fireEvent.click(screen.getByRole('button', { name: 'Clear goal' }));
    await waitFor(() => expect(screen.queryByTestId('goal-banner')).toBeNull());
    expect(localStorage.getItem(GOAL_KEY)).toBe('');
  });
});
