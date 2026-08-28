import { describe, it, expect, beforeEach } from 'vitest';
import {
  pushActivity,
  listActivity,
  clearActivity,
  subscribeActivity,
  _resetActivity,
  type AgentActivityEvent,
} from '../services/agentActivity';

function makeEvents(): AgentActivityEvent[] {
  _resetActivity();
  return [];
}

describe('agentActivity (#432)', () => {
  beforeEach(() => {
    _resetActivity();
  });

  it('pushActivity records an event with an incrementing id, tool, and kind', () => {
    pushActivity('call', 'run_shell_command', 'npm test');
    pushActivity('result', 'run_shell_command', 'ok');
    const events = listActivity();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ id: 1, kind: 'call', tool: 'run_shell_command' });
    expect(events[0].detail).toBe('npm test');
    expect(events[1]).toMatchObject({ id: 2, kind: 'result', tool: 'run_shell_command' });
  });

  it('uses "(tool)" when the tool name is missing', () => {
    pushActivity('call', '');
    expect(listActivity()[0].tool).toBe('(tool)');
  });

  it('truncates long detail to 400 chars', () => {
    pushActivity('call', 't', 'x'.repeat(1000));
    expect(listActivity()[0].detail?.length).toBe(400);
  });

  it('does not attach a detail when none is provided', () => {
    pushActivity('call', 't');
    expect(listActivity()[0].detail).toBeUndefined();
  });

  it('listActivity returns a defensive copy (mutating it does not affect the store)', () => {
    pushActivity('call', 't', 'd');
    const snapshot = listActivity();
    snapshot.push({ id: 99, kind: 'call', tool: 'x', ts: 0 });
    expect(listActivity()).toHaveLength(1);
  });

  it('clearActivity empties the log', () => {
    pushActivity('call', 't');
    clearActivity();
    expect(listActivity()).toHaveLength(0);
  });

  it('subscribeActivity fires listeners on push and clear, and the returned unsubscribe stops it', () => {
    _resetActivity();
    let count = 0;
    const off = subscribeActivity(() => count++);
    pushActivity('call', 't');
    pushActivity('result', 't');
    expect(count).toBe(2);
    off();
    clearActivity();
    expect(count).toBe(2);
  });

  it('caps history at 300 events (oldest dropped)', () => {
    for (let i = 0; i < 350; i++) pushActivity('call', 't');
    const events = listActivity();
    expect(events).toHaveLength(300);
    expect(events[0].id).toBe(51);
    expect(events[299].id).toBe(350);
  });
});
