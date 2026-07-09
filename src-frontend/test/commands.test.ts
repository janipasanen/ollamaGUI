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

// ── /model builtin (#263) ─────────────────────────────────────────────────────

describe('/model command (#263)', () => {
  it('is registered as a builtin command', () => {
    const cmd = findCommand('model');
    expect(cmd).toBeDefined();
    expect(cmd?.builtin).toBe(true);
  });

  it('with an argument returns builtin action: model + arg', () => {
    const r = runCommand('/model llama3');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') {
      expect(r.action).toBe('model');
      expect(r.arg).toBe('llama3');
    }
  });

  it('with no argument returns builtin action: model + empty arg', () => {
    const r = runCommand('/model');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') {
      expect(r.action).toBe('model');
      expect(r.arg).toBe('');
    }
  });

  it('filterCommands surfaces /model', () => {
    expect(filterCommands('model').some(c => c.name === 'model')).toBe(true);
  });
});

// ── /rename builtin (#269) ────────────────────────────────────────────────────

describe('/rename command (#269)', () => {
  it('is registered as a builtin command', () => {
    const cmd = findCommand('rename');
    expect(cmd).toBeDefined();
    expect(cmd?.builtin).toBe(true);
  });

  it('with an argument returns builtin action: rename + arg', () => {
    const r = runCommand('/rename My chat');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') {
      expect(r.action).toBe('rename');
      expect(r.arg).toBe('My chat');
    }
  });

  it('with no argument returns builtin action: rename + empty arg', () => {
    const r = runCommand('/rename');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') {
      expect(r.action).toBe('rename');
      expect(r.arg).toBe('');
    }
  });
});

// ── /export builtin (#271) ────────────────────────────────────────────────────

describe('/export command (#271)', () => {
  it('is registered as a builtin command', () => {
    const cmd = findCommand('export');
    expect(cmd).toBeDefined();
    expect(cmd?.builtin).toBe(true);
  });

  it('returns builtin action: export', () => {
    const r = runCommand('/export');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('export');
  });
});

// ── /new & /search builtins (#277/#276) ───────────────────────────────────────

describe('/new command (#277)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('new')?.builtin).toBe(true);
  });
  it('returns builtin action: new', () => {
    const r = runCommand('/new');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('new');
  });
});

describe('/search command (#276)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('search')?.builtin).toBe(true);
  });
  it('with an argument returns action: search + arg', () => {
    const r = runCommand('/search cats');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('search'); expect(r.arg).toBe('cats'); }
  });
  it('with no argument returns action: search + empty arg', () => {
    const r = runCommand('/search');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('search'); expect(r.arg).toBe(''); }
  });
});

// ── /copy builtin (#279) ──────────────────────────────────────────────────────

describe('/copy command (#279)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('copy')?.builtin).toBe(true);
  });
  it('returns builtin action: copy', () => {
    const r = runCommand('/copy');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('copy');
  });
});

// ── /pin & /archive builtins (#282/#283) ──────────────────────────────────────

describe('/pin command (#282)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('pin')?.builtin).toBe(true);
  });
  it('returns builtin action: pin', () => {
    const r = runCommand('/pin');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('pin');
  });
});

describe('/archive command (#283)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('archive')?.builtin).toBe(true);
  });
  it('returns builtin action: archive', () => {
    const r = runCommand('/archive');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('archive');
  });
});

// ── /tag, /duplicate, /title builtins (#285/#286/#287) ────────────────────────

describe('/tag command (#285)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('tag')?.builtin).toBe(true);
  });
  it('with an argument returns action: tag + arg', () => {
    const r = runCommand('/tag work');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('tag'); expect(r.arg).toBe('work'); }
  });
  it('with no argument returns action: tag + empty arg', () => {
    const r = runCommand('/tag');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.arg).toBe('');
  });
});

describe('/duplicate command (#286)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('duplicate')?.builtin).toBe(true);
  });
  it('returns builtin action: duplicate', () => {
    const r = runCommand('/duplicate');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('duplicate');
  });
});

describe('/title command (#287)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('title')?.builtin).toBe(true);
  });
  it('returns builtin action: title', () => {
    const r = runCommand('/title');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('title');
  });
});
