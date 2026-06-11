/**
 * Tests for #80: CLI struct mismatch fix and timeout-output correctness.
 *
 * Verifies that executeCommand routes through run_cli_command (not run_cli)
 * with the correct CliCommandRequest shape, and that partial output is
 * returned on timeout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CliToolWrapper } from '../services/cli-tool';

const defaultMockResult = {
  success: true,
  exit_code: 0,
  stdout: 'hello',
  stderr: '',
  timed_out: false,
  error: null,
};

let mockInvoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockInvoke = vi.fn().mockResolvedValue(defaultMockResult);
  CliToolWrapper.initializeWithTauri(mockInvoke);
  CliToolWrapper.approvalCallback = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CLI command routing (#80)', () => {
  it('calls run_cli_command (not run_cli)', async () => {
    await CliToolWrapper.executeCommand({ command: 'echo hello' });
    expect(mockInvoke).toHaveBeenCalledWith('run_cli_command', expect.any(Object));
    expect(mockInvoke).not.toHaveBeenCalledWith('run_cli', expect.any(Object));
  });

  it('wraps args in a request object matching CliCommandRequest', async () => {
    await CliToolWrapper.executeCommand({ command: 'echo hello world', cwd: '/tmp', timeoutMs: 5000 });
    const [cmd, args] = mockInvoke.mock.calls[0];
    expect(cmd).toBe('run_cli_command');
    expect(args.request).toBeDefined();
    expect(args.request.command).toBe('echo');
    expect(args.request.args).toEqual(['hello', 'world']);
    expect(args.request.cwd).toBe('/tmp');
    expect(args.request.timeout_ms).toBe(5000);
  });

  it('uses snake_case field names matching Rust CliCommandRequest', async () => {
    await CliToolWrapper.executeCommand({ command: 'ls', timeoutMs: 10_000 });
    const req = mockInvoke.mock.calls[0][1].request;
    // Must have timeout_ms (not timeoutMs)
    expect(req.timeout_ms).toBeDefined();
    expect((req as any).timeoutMs).toBeUndefined();
  });

  it('maps snake_case Rust response to TS CliCommandResponse', async () => {
    mockInvoke.mockResolvedValue({ success: true, exit_code: 0, stdout: 'out', stderr: 'err', timed_out: false, error: null });
    const result = await CliToolWrapper.executeCommand({ command: 'echo' });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('out');
    expect(result.timedOut).toBe(false);
  });

  it('returns denided when approval callback rejects', async () => {
    CliToolWrapper.approvalCallback = async () => false;
    const result = await CliToolWrapper.executeCommand({ command: 'rm -rf /' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('denied');
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('CLI timeout output (#80)', () => {
  it('returns timedOut=true and captured partial stdout on timeout', async () => {
    mockInvoke.mockResolvedValue({
      success: false,
      exit_code: null,
      stdout: 'partial output before kill',
      stderr: '(timed out after 100ms)',
      timed_out: true,
      error: 'Command timed out after 100ms',
    });
    const result = await CliToolWrapper.executeCommand({ command: 'sleep 100', timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
    expect(result.stdout).toBe('partial output before kill');
    expect(result.error).toContain('timed out');
  });

  it('stdout on timeout is not a stringified byte count', async () => {
    mockInvoke.mockResolvedValue({
      success: false, exit_code: null,
      stdout: 'real output', stderr: '(timed out)', timed_out: true, error: null,
    });
    const result = await CliToolWrapper.executeCommand({ command: 'slow', timeoutMs: 50 });
    // stdout must NOT be a pure numeric string (the bug was returning byte counts like "42")
    expect(/^\d+$/.test(result.stdout)).toBe(false);
    expect(result.stdout).toBe('real output');
  });
});

describe('CLI arg splitting (#80)', () => {
  it('handles a command with no args', async () => {
    await CliToolWrapper.executeCommand({ command: 'ls' });
    const req = mockInvoke.mock.calls[0][1].request;
    expect(req.command).toBe('ls');
    expect(req.args).toEqual([]);
  });

  it('handles quoted arg with space', async () => {
    await CliToolWrapper.executeCommand({ command: 'echo "hello world"' });
    const req = mockInvoke.mock.calls[0][1].request;
    expect(req.command).toBe('echo');
    expect(req.args).toContain('hello world');
  });
});
