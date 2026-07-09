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

// ── /folder & /system builtins (#288/#289) ────────────────────────────────────

describe('/folder command (#288)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('folder')?.builtin).toBe(true);
  });
  it('with an argument returns action: folder + arg', () => {
    const r = runCommand('/folder Work');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('folder'); expect(r.arg).toBe('Work'); }
  });
  it('with no argument returns action: folder + empty arg', () => {
    const r = runCommand('/folder');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.arg).toBe('');
  });
});

describe('/system command (#289)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('system')?.builtin).toBe(true);
  });
  it('with text returns action: system + arg', () => {
    const r = runCommand('/system Be concise');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('system'); expect(r.arg).toBe('Be concise'); }
  });
  it('with no argument returns action: system + empty arg', () => {
    const r = runCommand('/system');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.arg).toBe('');
  });
});

// ── /temp & /ctx builtins (#291/#292) ─────────────────────────────────────────

describe('/temp command (#291)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('temp')?.builtin).toBe(true);
  });
  it('with a value returns action: temp + arg', () => {
    const r = runCommand('/temp 0.7');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('temp'); expect(r.arg).toBe('0.7'); }
  });
});

describe('/ctx command (#292)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('ctx')?.builtin).toBe(true);
  });
  it('with a value returns action: ctx + arg', () => {
    const r = runCommand('/ctx 8192');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('ctx'); expect(r.arg).toBe('8192'); }
  });
});


// ── /topp, /predict & /stop builtins (#294/#295/#296) ─────────────────────────

describe('/topp command (#294)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('topp')?.builtin).toBe(true);
  });
  it('with a value returns action: topp + arg', () => {
    const r = runCommand('/topp 0.9');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('topp'); expect(r.arg).toBe('0.9'); }
  });
});

describe('/predict command (#295)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('predict')?.builtin).toBe(true);
  });
  it('with a value returns action: predict + arg', () => {
    const r = runCommand('/predict 512');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('predict'); expect(r.arg).toBe('512'); }
  });
});

describe('/stop command (#296)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('stop')?.builtin).toBe(true);
  });
  it('with a value returns action: stop + arg', () => {
    const r = runCommand('/stop <|end|>,\\n\\nUser');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('stop'); expect(r.arg).toBe('<|end|>,\\n\\nUser'); }
  });
});


// ── /topk builtin (#298) ──────────────────────────────────────────────────────

describe('/topk command (#298)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('topk')?.builtin).toBe(true);
  });
  it('with a value returns action: topk + arg', () => {
    const r = runCommand('/topk 40');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('topk'); expect(r.arg).toBe('40'); }
  });
});


// ── /cost builtin (#302) ──────────────────────────────────────────────────────

describe('/cost command (#302)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('cost')?.builtin).toBe(true);
  });
  it('returns action: cost with no arg', () => {
    const r = runCommand('/cost');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('cost'); expect(r.arg).toBeUndefined(); }
  });
});


// ── /compact builtin (#305) ───────────────────────────────────────────────────

describe('/compact command (#305)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('compact')?.builtin).toBe(true);
  });
  it('returns action: compact with no arg', () => {
    const r = runCommand('/compact');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('compact'); expect(r.arg).toBeUndefined(); }
  });
});


// ── /delete builtin (#311) ────────────────────────────────────────────────────

describe('/delete command (#311)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('delete')?.builtin).toBe(true);
  });
  it('returns action: delete with no arg', () => {
    const r = runCommand('/delete');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('delete'); expect(r.arg).toBeUndefined(); }
  });
});


// ── /models builtin (#314) ────────────────────────────────────────────────────

describe('/models command (#314)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('models')?.builtin).toBe(true);
  });
  it('returns action: models with no arg', () => {
    const r = runCommand('/models');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('models'); expect(r.arg).toBeUndefined(); }
  });
});


// ── /pull builtin (#316) ──────────────────────────────────────────────────────

describe('/pull command (#316)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('pull')?.builtin).toBe(true);
  });
  it('with a model name returns action: pull + arg', () => {
    const r = runCommand('/pull llama3');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('pull'); expect(r.arg).toBe('llama3'); }
  });
});


// ── /remove builtin (#318) ────────────────────────────────────────────────────

describe('/remove command (#318)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('remove')?.builtin).toBe(true);
  });
  it('with a model name returns action: remove + arg', () => {
    const r = runCommand('/remove llama3');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('remove'); expect(r.arg).toBe('llama3'); }
  });
});


// ── /params builtin (#326) ────────────────────────────────────────────────────

describe('/params command (#326)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('params')?.builtin).toBe(true);
  });
  it('returns action: params with no arg', () => {
    const r = runCommand('/params');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('params'); expect(r.arg).toBeUndefined(); }
  });
});


// ── /stats builtin (#328) ─────────────────────────────────────────────────────

describe('/stats command (#328)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('stats')?.builtin).toBe(true);
  });
  it('returns action: stats with no arg', () => {
    const r = runCommand('/stats');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('stats'); expect(r.arg).toBeUndefined(); }
  });
});


// ── /id builtin (#331) ───────────────────────────────────────────────────────

describe('/id command (#331)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('id')?.builtin).toBe(true);
  });
  it('returns action: id with no arg', () => {
    const r = runCommand('/id');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('id'); expect(r.arg).toBeUndefined(); }
  });
});


// ── /copy txt variant (#337) ──────────────────────────────────────────────────

describe('/copy command (#337)', () => {
  it('with no arg returns action: copy + undefined arg', () => {
    const r = runCommand('/copy');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('copy'); expect(r.arg).toBe(''); }
  });
  it('with txt arg returns action: copy + arg txt', () => {
    const r = runCommand('/copy txt');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('copy'); expect(r.arg).toBe('txt'); }
  });
});


// ── /merge builtin (#344) ────────────────────────────────────────────────────

describe('/merge command (#344)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('merge')?.builtin).toBe(true);
  });
  it('with a session id returns action: merge + arg', () => {
    const r = runCommand('/merge 12345');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('merge'); expect(r.arg).toBe('12345'); }
  });
  it('with no arg returns action: merge + empty arg', () => {
    const r = runCommand('/merge');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('merge'); expect(r.arg).toBe(''); }
  });
});


// ── /undo builtin (#346) ─────────────────────────────────────────────────────

describe('/undo command (#346)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('undo')?.builtin).toBe(true);
  });
  it('returns builtin action: undo', () => {
    const r = runCommand('/undo');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('undo');
  });
  it('ignores extra arguments', () => {
    const r = runCommand('/undo something');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('undo');
  });
});


// ── /diff builtin (#347) ─────────────────────────────────────────────────────

describe('/diff command (#347)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('diff')?.builtin).toBe(true);
  });
  it('with no arg returns builtin action: diff + empty arg', () => {
    const r = runCommand('/diff');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('diff'); expect(r.arg).toBe(''); }
  });
  it('with staged arg returns builtin action: diff + arg staged', () => {
    const r = runCommand('/diff staged');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('diff'); expect(r.arg).toBe('staged'); }
  });
});


// ── /reset builtin (#348) ─────────────────────────────────────────────────────

describe('/reset command (#348)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('reset')?.builtin).toBe(true);
  });
  it('returns builtin action: reset', () => {
    const r = runCommand('/reset');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('reset');
  });
});


// ── /tokens builtin (#349) ───────────────────────────────────────────────────

describe('/tokens command (#349)', () => {
  it('is registered as a builtin command', () => {
    expect(findCommand('tokens')?.builtin).toBe(true);
  });
  it('returns builtin action: tokens', () => {
    const r = runCommand('/tokens');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('tokens');
  });
});


// ── /add, /drop, /files builtins (#350) ──────────────────────────────────────

describe('/add /drop /files commands (#350)', () => {
  it('/add is registered as a builtin and passes the path arg', () => {
    expect(findCommand('add')?.builtin).toBe(true);
    const r = runCommand('/add src/main.ts');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('add'); expect(r.arg).toBe('src/main.ts'); }
  });
  it('/drop is registered as a builtin and passes the path arg', () => {
    expect(findCommand('drop')?.builtin).toBe(true);
    const r = runCommand('/drop src/main.ts');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('drop'); expect(r.arg).toBe('src/main.ts'); }
  });
  it('/files is registered as a builtin', () => {
    expect(findCommand('files')?.builtin).toBe(true);
    const r = runCommand('/files');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.action).toBe('files');
  });
});


// ── /run builtin (#353) ───────────────────────────────────────────────────────

describe('/run command (#353)', () => {
  it('is registered as a builtin and passes the joined command arg', () => {
    expect(findCommand('run')?.builtin).toBe(true);
    const r = runCommand('/run echo hello');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('run'); expect(r.arg).toBe('echo hello'); }
  });
  it('with no arg returns an empty arg', () => {
    const r = runCommand('/run');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.arg).toBe('');
  });
});


// ── /commit builtin (#357) ────────────────────────────────────────────────────

describe('/commit command (#357)', () => {
  it('is registered as a builtin and passes the message arg', () => {
    expect(findCommand('commit')?.builtin).toBe(true);
    const r = runCommand('/commit fix parser bug');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('commit'); expect(r.arg).toBe('fix parser bug'); }
  });
  it('with no arg returns an empty arg (auto-generate)', () => {
    const r = runCommand('/commit');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.arg).toBe('');
  });
});


// ── /tests builtin (#359) ─────────────────────────────────────────────────────

describe('/tests command (#359)', () => {
  it('is registered as a builtin and passes the command arg', () => {
    expect(findCommand('tests')?.builtin).toBe(true);
    const r = runCommand('/tests npm test');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') { expect(r.action).toBe('tests'); expect(r.arg).toBe('npm test'); }
  });
  it('with no arg returns an empty arg', () => {
    const r = runCommand('/tests');
    expect(r.kind).toBe('builtin');
    if (r.kind === 'builtin') expect(r.arg).toBe('');
  });
});
