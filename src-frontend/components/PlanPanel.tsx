import React from 'react';
import type { PlanItem, PlanStatus } from '../services/planStore';

const STATUS_ICON: Record<PlanStatus, string> = {
  pending: '○',
  in_progress: '▶',
  completed: '✓',
};

const STATUS_LABEL: Record<PlanStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
};

interface PlanPanelProps {
  plan: PlanItem[];
  dark: boolean;
  onClear?: () => void;
}

/**
 * Live plan checklist rendered above the chat when the agent publishes a plan
 * via the `update_plan` tool (#239).
 */
const PlanPanel: React.FC<PlanPanelProps> = ({ plan, dark, onClear }) => {
  if (!plan.length) return null;
  const done = plan.filter(p => p.status === 'completed').length;
  return (
    <section
      aria-label="Task plan"
      className={`mx-3 my-2 rounded-xl border p-3 ${dark ? 'bg-zinc-800/60 border-zinc-700' : 'bg-white border-zinc-200'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className={`text-xs font-semibold flex items-center gap-1.5 ${dark ? 'text-zinc-200' : 'text-zinc-700'}`}>
          📋 Plan
          <span className={`text-[10px] font-normal ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            {done}/{plan.length}
          </span>
        </h3>
        {onClear && (
          <button
            onClick={onClear}
            aria-label="Clear plan"
            className={`text-xs ${dark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600'}`}
          >✕</button>
        )}
      </div>
      <ol className="space-y-1">
        {plan.map((item, i) => (
          <li
            key={i}
            className={`flex items-start gap-2 text-xs ${item.status === 'completed' ? (dark ? 'text-zinc-500' : 'text-zinc-400') : (dark ? 'text-zinc-200' : 'text-zinc-700')}`}
          >
            <span
              aria-label={STATUS_LABEL[item.status]}
              className={`shrink-0 w-4 text-center ${
                item.status === 'completed' ? 'text-emerald-400'
                  : item.status === 'in_progress' ? 'text-blue-400 animate-pulse'
                  : (dark ? 'text-zinc-500' : 'text-zinc-400')
              }`}
            >
              {STATUS_ICON[item.status]}
            </span>
            <span className={item.status === 'completed' ? 'line-through' : ''}>{item.step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
};

export default PlanPanel;
