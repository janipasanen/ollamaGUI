import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TauriMcpStdioTransport } from '../services/mcp-tauri';

/**
 * Direct unit tests for TauriMcpStdioTransport — the low-level Tauri IPC wrapper
 * for MCP stdio servers.  Existing tests (mcp-transport.test.ts) mock the
 * transport methods at the spyOn level, so the actual invoke→response handling
 * logic (including the success:false check added in #436) was never exercised.
 */
describe('TauriMcpStdioTransport', () => {
  beforeEach(() => {
    TauriMcpStdioTransport._mockInvoke = null;
    // Clear the private clients map by spawning + closing, or access via a known session
  });

  afterEach(() => {
    TauriMcpStdioTransport._mockInvoke = null;
  });

  // ── spawnProcess ──────────────────────────────────────────────────────────

  it('spawnProcess succeeds and registers the client when success:true', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async (cmd: string, args: any) => {
      if (cmd === 'mcp_stdio_spawn')
        return { success: true, message: 'ok', session_id: args.sessionId };
      return { success: true };
    });

    const client = await TauriMcpStdioTransport.spawnProcess('echo', ['-n']);
    expect(client.command).toBe('echo');
    expect(client.args).toEqual(['-n']);
    expect(client.sessionId).toMatch(/^mcp_/);
    expect(TauriMcpStdioTransport._mockInvoke).toHaveBeenCalledWith(
      'mcp_stdio_spawn',
      expect.objectContaining({ command: 'echo', args: ['-n'] }),
    );
  });

  it('spawnProcess throws when the Rust side returns success:false (#436)', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async () => ({
      success: false,
      message: 'Session already exists',
      session_id: 'dup',
    }));

    await expect(TauriMcpStdioTransport.spawnProcess('echo')).rejects.toThrow(
      'Session already exists',
    );
  });

  it('spawnProcess throws with a generic message when success:false has no message', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async () => ({ success: false }));
    await expect(TauriMcpStdioTransport.spawnProcess('echo')).rejects.toThrow(
      'unknown error',
    );
  });

  it('spawnProcess forwards env vars to the invoke call', async () => {
    let captured: any;
    TauriMcpStdioTransport._mockInvoke = vi.fn(async (_cmd: string, args: any) => {
      captured = args;
      return { success: true, message: 'ok', session_id: args.sessionId };
    });

    await TauriMcpStdioTransport.spawnProcess('npx', ['server'], {
      API_KEY: 'secret',
    });
    expect(captured.env).toEqual({ API_KEY: 'secret' });
  });

  // ── sendRequest ───────────────────────────────────────────────────────────

  it('sendRequest throws "Client not found" for an unregistered session', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async () => ({ success: true }));
    await expect(
      TauriMcpStdioTransport.sendRequest(
        { sessionId: 'nope', command: 'x', args: [] },
        '{}',
      ),
    ).rejects.toThrow('Client not found');
  });

  it('sendRequest writes the request after the client is registered', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async (cmd: string, args: any) => {
      if (cmd === 'mcp_stdio_spawn')
        return { success: true, message: 'ok', session_id: args.sessionId };
      if (cmd === 'mcp_stdio_send') return { success: true, message: 'sent' };
      return { success: true };
    });

    const client = await TauriMcpStdioTransport.spawnProcess('echo');
    await TauriMcpStdioTransport.sendRequest(client, '{"method":"ping"}');
    expect(
      TauriMcpStdioTransport._mockInvoke,
    ).toHaveBeenCalledWith('mcp_stdio_send', expect.objectContaining({ request: '{"method":"ping"}' }));
  });

  // ── readResponse ──────────────────────────────────────────────────────────

  it('readResponse throws "Client not found" for an unregistered session', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async () => null);
    await expect(
      TauriMcpStdioTransport.readResponse({ sessionId: 'nope', command: 'x', args: [] }),
    ).rejects.toThrow('Client not found');
  });

  it('readResponse returns the raw string from the invoke call', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async (cmd: string, args: any) => {
      if (cmd === 'mcp_stdio_spawn')
        return { success: true, message: 'ok', session_id: args.sessionId };
      if (cmd === 'mcp_stdio_read') return '{"jsonrpc":"2.0","id":1,"result":{}}';
      return { success: true };
    });

    const client = await TauriMcpStdioTransport.spawnProcess('echo');
    const resp = await TauriMcpStdioTransport.readResponse(client);
    expect(resp).toBe('{"jsonrpc":"2.0","id":1,"result":{}}');
  });

  it('readResponse returns null when nothing is pending', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async (cmd: string, args: any) => {
      if (cmd === 'mcp_stdio_spawn')
        return { success: true, message: 'ok', session_id: args.sessionId };
      if (cmd === 'mcp_stdio_read') return null;
      return { success: true };
    });

    const client = await TauriMcpStdioTransport.spawnProcess('echo');
    const resp = await TauriMcpStdioTransport.readResponse(client);
    expect(resp).toBeNull();
  });

  // ── closeProcess ──────────────────────────────────────────────────────────

  it('closeProcess removes the client from the registry', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async (cmd: string, args: any) => {
      if (cmd === 'mcp_stdio_spawn')
        return { success: true, message: 'ok', session_id: args.sessionId };
      if (cmd === 'mcp_stdio_close') return { success: true, message: 'terminated' };
      return { success: true };
    });

    const client = await TauriMcpStdioTransport.spawnProcess('echo');
    // sendRequest should work before close
    await TauriMcpStdioTransport.sendRequest(client, '{}');
    await TauriMcpStdioTransport.closeProcess(client);
    // After close, sendRequest should throw "Client not found"
    await expect(TauriMcpStdioTransport.sendRequest(client, '{}')).rejects.toThrow(
      'Client not found',
    );
  });

  it('closeProcess swallows invoke errors (best-effort cleanup)', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async (cmd: string) => {
      if (cmd === 'mcp_stdio_spawn') return { success: true, message: 'ok' };
      throw new Error('invoke failed');
    });

    const client = await TauriMcpStdioTransport.spawnProcess('echo');
    // Should not throw even though invoke rejects
    await expect(TauriMcpStdioTransport.closeProcess(client)).resolves.toBeUndefined();
  });

  // ── checkProcessAlive ─────────────────────────────────────────────────────

  it('checkProcessAlive returns true when the invoke resolves to true', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async () => true);
    expect(await TauriMcpStdioTransport.checkProcessAlive('s1')).toBe(true);
  });

  it('checkProcessAlive returns false when the invoke rejects', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async () => {
      throw new Error('boom');
    });
    expect(await TauriMcpStdioTransport.checkProcessAlive('s1')).toBe(false);
  });

  // ── executeWithResponse ───────────────────────────────────────────────────

  it('executeWithResponse returns the first non-null response', async () => {
    let readCount = 0;
    TauriMcpStdioTransport._mockInvoke = vi.fn(async (cmd: string, args: any) => {
      if (cmd === 'mcp_stdio_spawn')
        return { success: true, message: 'ok', session_id: args.sessionId };
      if (cmd === 'mcp_stdio_send') return { success: true };
      if (cmd === 'mcp_stdio_read') {
        readCount++;
        if (readCount === 1) return null; // first poll: nothing yet
        return '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}';
      }
      return { success: true };
    });

    const client = await TauriMcpStdioTransport.spawnProcess('echo');
    const resp = await TauriMcpStdioTransport.executeWithResponse(client, '{}', 2000);
    expect(resp).toBe('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}');
  });

  it('executeWithResponse throws on timeout when no response arrives', async () => {
    TauriMcpStdioTransport._mockInvoke = vi.fn(async (cmd: string, args: any) => {
      if (cmd === 'mcp_stdio_spawn')
        return { success: true, message: 'ok', session_id: args.sessionId };
      if (cmd === 'mcp_stdio_send') return { success: true };
      if (cmd === 'mcp_stdio_read') return null; // never responds
      return { success: true };
    });

    const client = await TauriMcpStdioTransport.spawnProcess('echo');
    await expect(
      TauriMcpStdioTransport.executeWithResponse(client, '{}', 200),
    ).rejects.toThrow('Timeout waiting for MCP response');
  });
});
