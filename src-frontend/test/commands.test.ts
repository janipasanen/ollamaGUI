import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAllCommands, filterCommands, findCommand,
  loadUserCommands, addUserCommand, updateUserCommand, removeUserCommand,
  expandTemplate, runCommand,
} from '../services/commands';

beforeEach(() => {
  localStorage.clear();
});

// ── Registry ──────────────────────────────────────────────────────────────────

describe('command registry (#96)', () => {
  it('getAllCommands returns built-in commands', () => {
    const names = getAllCommands().map(c => c.name);
    expect(names).toContain('clear');
    expect(names).toContain('help');
    expect(names).toContain('review');
    expect(names).toContain('explain');
    expect(names).toContain('summarize');
  });

  it('filterCommands with empty query returns all commands', () => {
    expect(filterCommands('')).toEqual(getAllCommands());
  });

  it('filterCommands narrows by name prefix', () => {
    const matches = filterCommands('rev');
    expect(matches.some(c => c.name === 'review')).toBe(true);
    expect(matches.some(c => c.name === 'clear')).toBe(false);
  });

  it('filterCommands strips leading slash', () => {
    const matches = filterCommands('/rev');
    expect(matches.some(c => c.name === 'review')).toBe(true);
  });

  it('filterCommands searches description too', () => {
    const matches = filterCommands('keyboard');
    expect(matches.some(c => c.name === 'help')).toBe(true);
  });

  it('findCommand returns command ignoring slash prefix', () => {
    expect(findCommand('/clear')?.name).toBe('clear');
    expect(findCommand('clear')?.name).toBe('clear');
  });

  it('findCommand returns undefined for unknown command', () => {
    expect(findCommand('xyzzy')).toBeUndefined();
  });
});

// ── User commands ─────────────────────────────────────────────────────────────

describe('user command CRUD (#96)', () => {
  it('addUserCommand persists and appears in getAllCommands', () => {
    addUserCommand({ name: 'greet', description: 'Greet someone', template: 'Hello, $ARGUMENTS!' });
    const all = getAllCommands();
    expect(all.some(c => c.name === 'greet')).toBe(true);
  });

  it('updateUserCommand patches the command', () => {
    addUserCommand({ name: 'foo', description: 'Foo', template: 'Old $ARGUMENTS' });
    updateUserCommand('foo', { template: 'New $ARGUMENTS' });
    expect(findCommand('foo')?.template).toBe('New $ARGUMENTS');
  });

  it('removeUserCommand deletes by name', () => {
    addUserCommand({ name: 'bar', description: 'Bar', template: 'Bar $ARGUMENTS' });
    removeUserCommand('bar');
    expect(findCommand('bar')).toBeUndefined();
  });

  it('user commands survive round-trip through localStorage', () => {
    addUserCommand({ name: 'test', description: 'Test', template: '$ARGUMENTS' });
    expect(loadUserCommands()).toHaveLength(1);
    expect(loadUserCommands()[0].name).toBe('test');
  });
});

// ── Template expansion ─────────────────────────────────────────────────────────

describe('expandTemplate (#96)', () => {
  it('replaces $ARGUMENTS with the full arg string', () => {
    expect(expandTemplate('Review: $ARGUMENTS', 'my code')).toBe('Review: my code');
  });

  it('replaces $1, $2 with individual words', () => {
    expect(expandTemplate('$1 to $2', 'hello world')).toBe('hello to world');
  });

  it('handles empty args', () => {
    expect(expandTemplate('Review: $ARGUMENTS', '')).toBe('Review: ');
  });
});

// ── runCommand ────────────────────────────────────────────────────────────────

describe('runCommand (#96)', () => {
  it('returns passthrough for non-slash input', () => {
    const r = runCommand('hello');
    expect(r.kind).toBe('passthrough');
    if (r.kind === 'passthrough') expect(r.text).toBe('hello');
  });

  it('/clear returns builtin action: clear', () => {
    const r = runCommand('/clear');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('clear');
  });

  it('/help returns builtin action: help', () => {
    const r = runCommand('/help');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('help');
  });

  it('/review expands template with arguments', () => {
    const r = runCommand('/review my code');
    expect(r.kind).toBe('prompt');
    if (r.kind === 'prompt') expect(r.text).toContain('my code');
  });

  it('/unknown returns unknown kind', () => {
    const r = runCommand('/xyzzy');
    expect(r.kind).toBe('unknown');
  });

  it('user-defined template command expands correctly', () => {
    addUserCommand({ name: 'greet', description: 'Greet', template: 'Hello, $ARGUMENTS!' });
    const r = runCommand('/greet World');
    expect(r.kind).toBe('prompt');
    if (r.kind === 'prompt') expect(r.text).toBe('Hello, World!');
  });
});
