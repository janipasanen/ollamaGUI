import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolRegistry, registerCliTool, cliAllowlist } from '../services/tools';

// Mock the Tauri invoke API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('CLI Tool', () => {
  let mockInvoke: ReturnType<typeof vi.fn>;
  let approvalCallback: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const tauriCore = await import('@tauri-apps/api/core');
    mockInvoke = tauriCore.invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockReset();

    // Clear the allowlist and re-register for each test
    cliAllowlist.clear();
    toolRegistry.unregisterTool('run_shell_command');
    approvalCallback = vi.fn();
    registerCliTool(approvalCallback);
  });

  it('registers run_shell_command in the tool registry', () => {
    const tool = toolRegistry.getTool('run_shell_command');
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('run_shell_command');
  });

  it('calls approval callback before executing a new command', async () => {
    approvalCallback.mockResolvedValue(true);
    mockInvoke.mockResolvedValue({ stdout: 'hello', stderr: '', exit_code: 0, timed_out: false });

    const tool = toolRegistry.getTool('run_shell_command')!;
    await tool.execute({ command: 'echo hello' });

    expect(approvalCallback).toHaveBeenCalledWith('echo hello', undefined);
  });

  it('calls invoke with correct args when approved', async () => {
    approvalCallback.mockResolvedValue(true);
    mockInvoke.mockResolvedValue({ stdout: 'result', stderr: '', exit_code: 0, timed_out: false });

    const tool = toolRegistry.getTool('run_shell_command')!;
    await tool.execute({ command: 'ls -la', cwd: '/tmp' });

    expect(mockInvoke).toHaveBeenCalledWith('run_cli', {
      command: 'ls -la',
      cwd: '/tmp',
      timeoutMs: 30_000,
    });
  });

  it('returns denied error when approval callback returns false', async () => {
    approvalCallback.mockResolvedValue(false);

    const tool = toolRegistry.getTool('run_shell_command')!;
    const result = await tool.execute({ command: 'rm -rf /' });

    expect(result).toMatchObject({ error: 'Command denied by user.', exit_code: -1 });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('skips approval for commands in the allowlist', async () => {
    cliAllowlist.add('echo allowed');
    mockInvoke.mockResolvedValue({ stdout: 'allowed', stderr: '', exit_code: 0, timed_out: false });

    const tool = toolRegistry.getTool('run_shell_command')!;
    await tool.execute({ command: 'echo allowed' });

    expect(approvalCallback).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith('run_cli', expect.objectContaining({ command: 'echo allowed' }));
  });

  it('formats timed-out results clearly', async () => {
    approvalCallback.mockResolvedValue(true);
    mockInvoke.mockResolvedValue({ stdout: '', stderr: 'Command timed out after 30000ms', exit_code: -1, timed_out: true });

    const tool = toolRegistry.getTool('run_shell_command')!;
    const result = await tool.execute({ command: 'sleep 9999' });

    expect(result.timed_out).toBe(true);
    expect(result.output).toContain('TIMED OUT');
  });

  it('combines stdout and stderr in output', async () => {
    approvalCallback.mockResolvedValue(true);
    mockInvoke.mockResolvedValue({ stdout: 'out', stderr: 'err', exit_code: 1, timed_out: false });

    const tool = toolRegistry.getTool('run_shell_command')!;
    const result = await tool.execute({ command: 'bad-cmd' });

    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
  });
});
