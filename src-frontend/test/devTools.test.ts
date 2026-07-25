import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseRunOutput, registerDevTools, getTestCommand, getCheckCommand, makePostEditVerifyHook, reviewDiffText } from '../services/devTools';
import { toolRegistry, _cliMocks } from '../services/tools';
import { setWorkspaceRoot, clearWorkspaceRoot, _mocks as fsMocks } from '../services/fileTools';

beforeEach(() => {
  _cliMocks.invoke = null;
  fsMocks.invoke = null;
  clearWorkspaceRoot();
});

afterEach(() => {
  _cliMocks.invoke = null;
  fsMocks.invoke = null;
  clearWorkspaceRoot();
});

describe('parseRunOutput (#423/#424)', () => {
  it('marks a clean exit as passed with a summary', () => {
    const r = parseRunOutput({ stdout: 'Tests 10 passed (10)\n', stderr: '', exit_code: 0, timed_out: false });
    expect(r.passed).toBe(true);
    expect(r.exit_code).toBe(0);
    expect(r.summary).toContain('10 passed');
    expect(r.failures).toHaveLength(0);
  });

  it('collects failure lines and marks not-passed on non-zero exit', () => {
    const out = [
      'FAIL src/a.test.ts > does a thing',
      '  AssertionError: expected 1 to be 2',
      'Tests 1 failed | 9 passed (10)',
    ].join('\n');
    const r = parseRunOutput({ stdout: out, stderr: '', exit_code: 1, timed_out: false });
    expect(r.passed).toBe(false);
    expect(r.failures.some(l => l.includes('FAIL src/a.test.ts'))).toBe(true);
    expect(r.summary).toContain('1 failed');
  });

  it('captures tsc-style diagnostics from stderr', () => {
    const r = parseRunOutput({
      stdout: '',
      stderr: "src/app.ts(12,5): error TS2322: Type 'x' is not assignable.",
      exit_code: 2,
      timed_out: false,
    });
    expect(r.passed).toBe(false);
    expect(r.failures.some(l => l.includes('error TS2322'))).toBe(true);
  });

  it('reports timed_out as not passed', () => {
    const r = parseRunOutput({ stdout: '', stderr: '', exit_code: 0, timed_out: true });
    expect(r.passed).toBe(false);
    expect(r.summary).toBe('timed out');
  });
});

describe('run_tests / run_checks tools (#423/#424)', () => {
  it('registers both tools', () => {
    registerDevTools();
    expect(toolRegistry.getTool('run_tests')).toBeDefined();
    expect(toolRegistry.getTool('run_checks')).toBeDefined();
  });

  it('run_tests errors when no workspace is open', async () => {
    registerDevTools();
    const res = await toolRegistry.getTool('run_tests')!.execute({});
    expect((res as any).error).toMatch(/No workspace/);
  });

  it('run_tests runs the command in the workspace root and parses output', async () => {
    registerDevTools();
    fsMocks.invoke = async () => undefined; // set_workspace_root
    await setWorkspaceRoot('/w');
    let captured: any = null;
    _cliMocks.invoke = async (_cmd, args) => {
      captured = args;
      return { stdout: 'Tests 3 passed (3)', stderr: '', exit_code: 0, timed_out: false };
    };
    const res = await toolRegistry.getTool('run_tests')!.execute({ command: 'vitest run' });
    expect(captured.command).toBe('vitest run');
    expect(captured.cwd).toBe('/w');
    expect(captured.timeoutMs).toBeGreaterThan(30_000);
    expect((res as any).passed).toBe(true);
  });

  it('defaults to the configured commands', () => {
    expect(getTestCommand()).toBeTruthy();
    expect(getCheckCommand()).toBeTruthy();
  });
});

describe('reviewDiffText (#428)', () => {
  const diff = [
    'diff --git a/src/x.ts b/src/x.ts',
    '--- a/src/x.ts',
    '+++ b/src/x.ts',
    '@@ -10,3 +10,6 @@',
    ' context line',
    '+  console.log("debug", x)',
    '+  // TODO: fix this later',
    '-  const removed = 1',
    '+  const apiKey = "abcdef0123456789ABCDEF"',
  ].join('\n');

  it('flags added debug/TODO/secret lines but not removed lines', () => {
    const f = reviewDiffText(diff);
    const cats = f.map(x => x.category);
    expect(cats).toContain('debug');
    expect(cats).toContain('todo');
    expect(cats).toContain('secret');
    // Removed line ("const removed") must not be reviewed.
    expect(f.every(x => !x.snippet.includes('removed'))).toBe(true);
  });

  it('assigns new-file line numbers from the hunk header', () => {
    const f = reviewDiffText(diff);
    const dbg = f.find(x => x.category === 'debug');
    // context line is 10, console.log is the next added line → 11.
    expect(dbg?.line).toBe(11);
  });

  it('flags focused tests and empty catch blocks', () => {
    const d = '@@ -1 +1,2 @@\n+  it.only("x", () => {})\n+  try { f() } catch (e) {}';
    const cats = reviewDiffText(d).map(x => x.category);
    expect(cats).toContain('test');
    expect(cats).toContain('error-handling');
  });

  it('returns nothing for a clean diff', () => {
    expect(reviewDiffText('@@ -1 +1 @@\n+  const y = compute()')).toHaveLength(0);
  });

  it('registers the review_diff tool', () => {
    registerDevTools();
    expect(toolRegistry.getTool('review_diff')).toBeDefined();
    expect(toolRegistry.getTool('review_diff')?.readOnly).toBe(true);
  });
});

describe('makePostEditVerifyHook (#425)', () => {
  it('is a no-op when disabled', async () => {
    const hook = makePostEditVerifyHook(() => false);
    const res = await hook('write_file', {}, '{"success":true}');
    expect(res.action).toBe('allow');
  });

  it('is a no-op for non-edit tools even when enabled', async () => {
    const hook = makePostEditVerifyHook(() => true);
    const res = await hook('read_file', {}, '{"content":"x"}');
    expect(res.action).toBe('allow');
  });

  it('appends failing diagnostics after a successful edit', async () => {
    fsMocks.invoke = async () => undefined;
    await setWorkspaceRoot('/w');
    _cliMocks.invoke = async () => ({
      stdout: "src/a.ts(1,1): error TS1005: ';' expected.",
      stderr: '',
      exit_code: 2,
      timed_out: false,
    });
    const hook = makePostEditVerifyHook(() => true);
    const res = await hook('apply_edit', { path: 'src/a.ts' }, '{"success":true}');
    expect(res.action).toBe('transform');
    expect(res.content).toContain('checks FAILED');
    expect(res.content).toContain('error TS1005');
  });

  it('notes success when checks pass', async () => {
    fsMocks.invoke = async () => undefined;
    await setWorkspaceRoot('/w');
    _cliMocks.invoke = async () => ({ stdout: '0 errors', stderr: '', exit_code: 0, timed_out: false });
    const hook = makePostEditVerifyHook(() => true);
    const res = await hook('write_file', {}, '{"success":true}');
    expect(res.action).toBe('transform');
    expect(res.content).toContain('checks passed');
  });
});
