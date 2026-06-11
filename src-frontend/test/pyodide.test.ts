import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runPython, _mocks, resetPyodideInstance } from '../services/pyodide';

beforeEach(() => {
  _mocks.runPython = null;
  resetPyodideInstance();
});

afterEach(() => {
  _mocks.runPython = null;
  resetPyodideInstance();
});

// ── Mock-based tests (no real Pyodide needed in CI) ────────────────────────────

describe('runPython via mock (#128)', () => {
  it('returns stdout output', async () => {
    _mocks.runPython = async (_code) => ({
      stdout: 'hello world\n',
      stderr: '',
      result: null,
      error: null,
    });
    const res = await runPython('print("hello world")');
    expect(res.stdout).toBe('hello world\n');
    expect(res.error).toBeNull();
  });

  it('returns result repr for expression', async () => {
    _mocks.runPython = async (_code) => ({
      stdout: '',
      stderr: '',
      result: '42',
      error: null,
    });
    const res = await runPython('6 * 7');
    expect(res.result).toBe('42');
    expect(res.error).toBeNull();
  });

  it('returns error message on syntax error', async () => {
    _mocks.runPython = async (_code) => ({
      stdout: '',
      stderr: '',
      result: null,
      error: 'SyntaxError: invalid syntax',
    });
    const res = await runPython('def broken(');
    expect(res.error).toContain('SyntaxError');
    expect(res.result).toBeNull();
  });

  it('returns stderr output', async () => {
    _mocks.runPython = async (_code) => ({
      stdout: '',
      stderr: 'warning: something\n',
      result: null,
      error: null,
    });
    const res = await runPython('import sys; sys.stderr.write("warning: something\\n")');
    expect(res.stderr).toContain('warning');
  });

  it('captures both stdout and result together', async () => {
    _mocks.runPython = async (_code) => ({
      stdout: 'computed\n',
      stderr: '',
      result: '100',
      error: null,
    });
    const res = await runPython('print("computed"); 100');
    expect(res.stdout).toBe('computed\n');
    expect(res.result).toBe('100');
  });

  it('passes code string to mock', async () => {
    let captured = '';
    _mocks.runPython = async (code) => {
      captured = code;
      return { stdout: '', stderr: '', result: null, error: null };
    };
    await runPython('x = 1 + 2');
    expect(captured).toBe('x = 1 + 2');
  });

  it('result is null when expression returns None', async () => {
    _mocks.runPython = async (_code) => ({
      stdout: '',
      stderr: '',
      result: null,
      error: null,
    });
    const res = await runPython('x = 5');
    expect(res.result).toBeNull();
    expect(res.error).toBeNull();
  });

  it('result is null when code raises an exception', async () => {
    _mocks.runPython = async (_code) => ({
      stdout: '',
      stderr: '',
      result: null,
      error: 'NameError: name "undefined_var" is not defined',
    });
    const res = await runPython('print(undefined_var)');
    expect(res.result).toBeNull();
    expect(res.error).toMatch(/NameError/);
  });

  it('multiline code block executes completely', async () => {
    _mocks.runPython = async (_code) => ({
      stdout: 'line1\nline2\n',
      stderr: '',
      result: null,
      error: null,
    });
    const res = await runPython('print("line1")\nprint("line2")');
    expect(res.stdout).toBe('line1\nline2\n');
  });

  it('empty code returns empty result', async () => {
    _mocks.runPython = async (_code) => ({
      stdout: '',
      stderr: '',
      result: null,
      error: null,
    });
    const res = await runPython('');
    expect(res.stdout).toBe('');
    expect(res.result).toBeNull();
    expect(res.error).toBeNull();
  });
});

// ── Tool registration ──────────────────────────────────────────────────────────

describe('registerPythonTool (#128)', () => {
  it('registers run_python in the tool registry', async () => {
    const { registerPythonTool } = await import('../services/pyodide');
    const { toolRegistry } = await import('../services/tools');
    registerPythonTool();
    const tool = toolRegistry.getTool('run_python');
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('run_python');
  });

  it('run_python tool delegates to runPython', async () => {
    const { registerPythonTool } = await import('../services/pyodide');
    const { toolRegistry } = await import('../services/tools');
    _mocks.runPython = async (_code) => ({
      stdout: 'tool output\n',
      stderr: '',
      result: null,
      error: null,
    });
    registerPythonTool();
    const tool = toolRegistry.getTool('run_python');
    const result = await tool!.execute({ code: 'print("tool output")' });
    expect((result as { stdout: string }).stdout).toBe('tool output\n');
  });
});
