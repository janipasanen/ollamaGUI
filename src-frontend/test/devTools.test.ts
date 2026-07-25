import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseRunOutput, registerDevTools, getTestCommand, getCheckCommand } from '../services/devTools';
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
