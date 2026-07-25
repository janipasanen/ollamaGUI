import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import AgentActivityPanel, { registerAgentActivityPanel } from '../components/AgentActivityPanel';
import { pushActivity, listActivity, clearActivity, subscribeActivity, _resetActivity } from '../services/agentActivity';
import { panelRegistry } from '../components/PanelShell';

beforeEach(() => { _resetActivity(); });
afterEach(() => { _resetActivity(); });

describe('agentActivity store (#432)', () => {
  it('records call/result events and lists them in order', () => {
    pushActivity('call', 'search_files', '{"query":"x"}');
    pushActivity('result', 'search_files', '3 hits');
    const evs = listActivity();
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ kind: 'call', tool: 'search_files' });
    expect(evs[1]).toMatchObject({ kind: 'result', tool: 'search_files' });
  });

  it('notifies subscribers and clears', () => {
    const cb = vi.fn();
    const unsub = subscribeActivity(cb);
    pushActivity('call', 'read_file');
    expect(cb).toHaveBeenCalled();
    clearActivity();
    expect(listActivity()).toHaveLength(0);
    unsub();
  });

  it('truncates long detail to 400 chars', () => {
    pushActivity('result', 'x', 'a'.repeat(1000));
    expect(listActivity()[0].detail!.length).toBe(400);
  });
});

describe('AgentActivityPanel (#432)', () => {
  it('shows empty state then live events', () => {
    render(<AgentActivityPanel dark={false} />);
    expect(screen.getByText(/No agent activity yet/)).toBeInTheDocument();
    act(() => { pushActivity('call', 'run_tests', '{}'); });
    expect(screen.getByText('run_tests')).toBeInTheDocument();
  });

  it('clear button empties the timeline', () => {
    act(() => { pushActivity('call', 'git_status'); });
    render(<AgentActivityPanel dark={false} />);
    expect(screen.getByText('git_status')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Clear agent activity'));
    expect(screen.queryByText('git_status')).not.toBeInTheDocument();
  });

  it('registers into the panel registry', () => {
    registerAgentActivityPanel();
    expect(panelRegistry.list().map((p: any) => p.id)).toContain('agent-activity');
  });
});
