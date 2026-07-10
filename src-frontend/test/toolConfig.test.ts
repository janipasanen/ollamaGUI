import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toolRegistry } from '../services/tools';
import {
  loadDisabledTools, saveDisabledTools, isToolEnabled, setToolEnabled,
  getEnabledToolFilter, listToolStatuses,
} from '../services/toolConfig';

beforeEach(() => {
  localStorage.clear();
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
  // Register a couple of representative tools.
  toolRegistry.registerTool({ name: 'read_file', description: 'read', readOnly: true, parameters: { type: 'object', properties: {} }, execute: async () => ({}) });
  toolRegistry.registerTool({ name: 'run_shell_command', description: 'shell', parameters: { type: 'object', properties: {} }, execute: async () => ({}) });
});

afterEach(() => {
  localStorage.clear();
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
});

describe('toolConfig persistence (#399)', () => {
  it('starts with nothing disabled', () => {
    expect(loadDisabledTools().size).toBe(0);
    expect(isToolEnabled('read_file')).toBe(true);
  });

  it('setToolEnabled(false) disables + persists; (true) re-enables', () => {
    const afterDisable = setToolEnabled('run_shell_command', false);
    expect(afterDisable.has('run_shell_command')).toBe(true);
    // Persisted across a fresh load.
    expect(loadDisabledTools().has('run_shell_command')).toBe(true);
    expect(isToolEnabled('run_shell_command')).toBe(false);
    const afterEnable = setToolEnabled('run_shell_command', true);
    expect(afterEnable.has('run_shell_command')).toBe(false);
    expect(isToolEnabled('run_shell_command')).toBe(true);
  });

  it('saveDisabledTools round-trips a set', () => {
    saveDisabledTools(new Set(['a', 'b']));
    expect(Array.from(loadDisabledTools()).sort()).toEqual(['a', 'b']);
  });
});

describe('getEnabledToolFilter (#399)', () => {
  it('returns null when nothing is disabled (default = expose all)', () => {
    expect(getEnabledToolFilter()).toBeNull();
  });

  it('returns only enabled tool names when some are disabled', () => {
    setToolEnabled('run_shell_command', false);
    const filter = getEnabledToolFilter();
    expect(filter).not.toBeNull();
    expect(filter).toContain('read_file');
    expect(filter).not.toContain('run_shell_command');
  });

  it('respects an explicit disabled set argument', () => {
    const filter = getEnabledToolFilter(new Set(['read_file']));
    expect(filter).toContain('run_shell_command');
    expect(filter).not.toContain('read_file');
  });
});

describe('listToolStatuses (#399)', () => {
  it('lists every registered tool with enabled + readOnly flags', () => {
    const statuses = listToolStatuses();
    const names = statuses.map(s => s.name);
    expect(names).toContain('read_file');
    expect(names).toContain('run_shell_command');
    const rd = statuses.find(s => s.name === 'read_file')!;
    expect(rd.enabled).toBe(true);
    expect(rd.readOnly).toBe(true);
  });

  it('reflects disabled state', () => {
    setToolEnabled('read_file', false);
    const rd = listToolStatuses().find(s => s.name === 'read_file')!;
    expect(rd.enabled).toBe(false);
  });
});
