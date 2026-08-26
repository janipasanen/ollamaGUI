import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { toolRegistry, registerCliTool, cliAllowlist, toolCallName, toolCallArgs } from '../services/tools';

// Mock the Tauri invoke API
vi.mock('@tauri-apps/api', () => ({
  invoke: vi.fn(),
}));

describe('CLI Tool', () => {
  let mockInvoke: Mock<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>;
  let approvalCallback: Mock<(command: string, cwd?: string) => Promise<boolean>>;

  beforeEach(async () => {
    const tauriCore = await import('@tauri-apps/api');
    mockInvoke = tauriCore.invoke as unknown as typeof mockInvoke;
    mockInvoke.mockReset();

    // Clear the allowlist and re-register for each test
    cliAllowlist.clear();
    toolRegistry.unregisterTool('run_shell_command');
    approvalCallback = vi.fn<(command: string, cwd?: string) => Promise<boolean>>();
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

describe('toolCallName / toolCallArgs helpers (#445)', () => {
  it('toolCallName uses function.name by default', () => {
    expect(toolCallName({ function: { name: 'read_file', arguments: '{}' } })).toBe('read_file');
  });

  it('toolCallName falls back to top-level name when function.name is absent', () => {
    expect(toolCallName({ name: 'fallback_name', function: { name: '', arguments: '{}' } })).toBe('fallback_name');
  });

  it('toolCallName uses top-level name when function is missing entirely', () => {
    // Some Ollama models send { name, arguments } without a nested function object.
    // toolCallName must not crash — it should use the top-level name.
    expect(toolCallName({ name: 'safe_name', arguments: '{}' } as any)).toBe('safe_name');
  });

  it('toolCallArgs parses string arguments', () => {
    expect(toolCallArgs({ function: { name: 'x', arguments: '{"a":1}' } })).toEqual({ a: 1 });
  });

  it('toolCallArgs returns object arguments as-is', () => {
    expect(toolCallArgs({ function: { name: 'x', arguments: { b: 2 } } })).toEqual({ b: 2 });
  });

  it('toolCallArgs returns empty object for undefined arguments', () => {
    expect(toolCallArgs({ function: { name: 'x', arguments: undefined as any } })).toEqual({});
  });

  // ── #449: missing function entirely ──────────────────────────────────────

  it('toolCallName returns unknown when both name and function are missing (#449)', () => {
    expect(toolCallName({} as any)).toBe('unknown');
  });

  it('toolCallArgs uses top-level arguments when function is missing (#449)', () => {
    expect(toolCallArgs({ name: 'x', arguments: '{"a":1}' } as any)).toEqual({ a: 1 });
  });

  it('toolCallArgs uses top-level object arguments when function is missing (#449)', () => {
    expect(toolCallArgs({ name: 'x', arguments: { b: 2 } } as any)).toEqual({ b: 2 });
  });

  it('toolCallArgs returns empty object when both function and arguments are missing (#449)', () => {
    expect(toolCallArgs({ name: 'x' } as any)).toEqual({});
  });

  it('executeToolCall does not crash when function is missing (#449)', async () => {
    // Register a test tool
    toolRegistry.registerTool({
      name: 'test_no_function',
      description: 'test',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true }),
    });
    // Tool call with only top-level name, no function
    const result = await toolRegistry.executeToolCall({ name: 'test_no_function', arguments: '{}' } as any);
    expect(result.name).toBe('test_no_function');
    expect(JSON.parse(result.content)).toEqual({ ok: true });
    toolRegistry.unregisterTool('test_no_function');
  });

  it('executeToolCall throws Tool not found for unknown name with missing function (#449)', async () => {
    await expect(toolRegistry.executeToolCall({ name: 'nonexistent_tool', arguments: '{}' } as any))
      .rejects.toThrow(/nonexistent_tool not found/);
  });

  // ── #464: malformed JSON arguments must not crash the agent loop ──────────

  it('toolCallArgs returns {} for malformed JSON string arguments (#464)', () => {
    expect(toolCallArgs({ function: { name: 'x', arguments: "{'a': 1}" } })).toEqual({});
  });

  it('toolCallArgs returns {} for truncated JSON string arguments (#464)', () => {
    expect(toolCallArgs({ function: { name: 'x', arguments: '{"a":' } })).toEqual({});
  });

  it('toolCallArgs returns {} for non-JSON string arguments (#464)', () => {
    expect(toolCallArgs({ function: { name: 'x', arguments: 'not json' } })).toEqual({});
  });

  it('toolCallArgs returns {} for malformed top-level arguments (#464)', () => {
    expect(toolCallArgs({ name: 'x', arguments: '{bad}' } as any)).toEqual({});
  });

  it('executeToolCall does not crash on malformed JSON arguments (#464)', async () => {
    toolRegistry.registerTool({
      name: 'test_malformed_args',
      description: 'test',
      parameters: { type: 'object', properties: {} },
      execute: async (params) => ({ received: params }),
    });
    const result = await toolRegistry.executeToolCall({
      function: { name: 'test_malformed_args', arguments: "{'bad': true,}" },
    } as any);
    expect(JSON.parse(result.content)).toEqual({ received: {} });
    toolRegistry.unregisterTool('test_malformed_args');
  });
});
