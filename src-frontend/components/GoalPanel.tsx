/**
 * Goal mode settings (#668).
 *
 * A run is only as useful as its success criterion. This panel asks for one
 * sentence ("make the failing test pass without changing the public API") and,
 * optionally, a second model to judge progress against it. Both persist, so a
 * goal survives a reload the same way the theme does.
 */

import React from 'react';

export const GOAL_KEY = 'ollama_gui_goal';
export const GOAL_JUDGE_ENABLED_KEY = 'ollama_gui_goal_judge_enabled';
export const GOAL_JUDGE_MODEL_KEY = 'ollama_gui_goal_judge_model';

export interface GoalSettings {
  goal: string;
  judgeEnabled: boolean;
  /** Empty means "use the chat model" — resolved at run time. */
  judgeModel: string;
}

export const EMPTY_GOAL_SETTINGS: GoalSettings = {
  goal: '',
  judgeEnabled: false,
  judgeModel: '',
};

export function loadGoalSettings(): GoalSettings {
  try {
    return {
      goal: localStorage.getItem(GOAL_KEY) ?? '',
      judgeEnabled: localStorage.getItem(GOAL_JUDGE_ENABLED_KEY) === 'true',
      judgeModel: localStorage.getItem(GOAL_JUDGE_MODEL_KEY) ?? '',
    };
  } catch {
    return { ...EMPTY_GOAL_SETTINGS };
  }
}

export function saveGoalSettings(settings: GoalSettings): void {
  try {
    localStorage.setItem(GOAL_KEY, settings.goal);
    localStorage.setItem(GOAL_JUDGE_ENABLED_KEY, settings.judgeEnabled ? 'true' : 'false');
    localStorage.setItem(GOAL_JUDGE_MODEL_KEY, settings.judgeModel);
  } catch {
    // Storage full/unavailable: the settings stay in memory for this run.
  }
}

/** Local switch: App's Toggle is not exported, and this panel must stand alone. */
const Switch: React.FC<{ checked: boolean; onChange: () => void; dark: boolean; label: string }> = ({
  checked, onChange, dark, label,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={onChange}
    className={`relative w-12 h-6 rounded-full transition-colors flex items-center shrink-0 ${dark ? 'bg-zinc-700' : 'bg-zinc-300'}`}
  >
    <span className={`absolute w-5 h-5 rounded-full transition-transform ${checked ? 'translate-x-6 bg-blue-500' : 'translate-x-1 bg-white'}`} />
  </button>
);

export interface GoalPanelProps {
  dark: boolean;
  /** Model names available to judge with. */
  models: string[];
  settings: GoalSettings;
  onChange: (settings: GoalSettings) => void;
}

export const GoalPanel: React.FC<GoalPanelProps> = ({ dark, models, settings, onChange }) => {
  const label = `block text-sm font-medium mb-1 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`;
  const hint = `text-xs mb-3 ${dark ? 'text-zinc-500' : 'text-zinc-500'}`;
  const field = `w-full text-xs px-2 py-1.5 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${
    dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200 placeholder-zinc-600' : 'bg-white border-zinc-300 text-zinc-800'
  }`;

  return (
    <div
      data-testid="goal-panel"
      className={`p-4 rounded-xl border ${dark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}
    >
      <label className={label} htmlFor="goal-input">Goal for this run</label>
      <p className={hint}>
        State the success criterion. In agentic mode it is given to the model as the
        target, and a judge can check it before the run stops.
      </p>
      <textarea
        id="goal-input"
        data-testid="goal-input"
        value={settings.goal}
        onChange={e => onChange({ ...settings, goal: e.target.value })}
        rows={2}
        placeholder="e.g. Make the failing login test pass without changing the public API."
        className={`${field} resize-none mb-3`}
      />

      <div className="flex items-center justify-between mb-2">
        <div>
          <span className={`text-xs ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>Judge checkpoints</span>
          <p className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            Before the run ends, ask a second model whether the goal is met, or what is blocking it.
          </p>
        </div>
        <Switch
          dark={dark}
          label="Judge checkpoints"
          checked={settings.judgeEnabled}
          onChange={() => onChange({ ...settings, judgeEnabled: !settings.judgeEnabled })}
        />
      </div>

      {settings.judgeEnabled && (
        <>
          <label className={`block text-xs mb-1 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`} htmlFor="judge-model">
            Judge model
          </label>
          <select
            id="judge-model"
            data-testid="judge-model"
            value={settings.judgeModel}
            onChange={e => onChange({ ...settings, judgeModel: e.target.value })}
            className={field}
          >
            <option value="">— use the chat model —</option>
            {models.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <p className={`text-[10px] mt-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            A small, fast model is enough. A blocked verdict with advice is fed back to the
            main model, which gets a few more iterations.
          </p>
        </>
      )}
    </div>
  );
};
