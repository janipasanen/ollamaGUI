import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpHttpTransport, McpReauthRequiredError } from '../services/mcp-http';
import { tokenStore, authMetaStore } from '../services/mcpAuth';
import { McpServerConfig } from '../services/mcp';

const CFG = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 'h1', name: 'H', type: 'http', url: 'https://srv.example.com/mcp',
  enabled: true, toolsEnabled: true, ...over,
} as McpServerConfig);

// Capture the Authorization header from the outgoing request; return a 200 result.
function captureHeaderMock(captured: { auth?: string }, status = 200) {
  return async (_cmd: string, args: any) => {
    captured.auth = args.request.headers.Authorization;
    const req = JSON.parse(args.request.body);
    return {
      success: status < 400,
      status,
      headers: {},
      body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [] } }),
    };
  };
}

const toolsListReq = { jsonrpc: '2.0' as const, id: 2, method: 'tools/list' };

describe('HTTP MCP OAuth token attachment (#107)', () => {
  beforeEach(() => {
    localStorage.clear();
    McpHttpTransport.clearSessions();
    McpHttpTransport._mockInvoke = null;
    vi.restoreAllMocks();
  });

  it('sends a stored, valid OAuth access token as a bearer', async () => {
    tokenStore.save('h1', { access_token: 'tok1', token_type: 'Bearer', expires_at: Date.now() + 3_600_000 });
    authMetaStore.save('h1', { tokenEndpoint: 'https://auth.example.com/token' });
    localStorage.setItem('mcp_clients', JSON.stringify({ h1: { client_id: 'c1' } }));

    const captured: { auth?: string } = {};
    McpHttpTransport._mockInvoke = captureHeaderMock(captured);

    await McpHttpTransport.initializeSession(CFG());
    await McpHttpTransport.sendRequest('h1', toolsListReq);

    expect(captured.auth).toBe('Bearer tok1');
  });

  it('refreshes an expired access token and uses the fresh one', async () => {
    tokenStore.save('h1', { access_token: 'old', token_type: 'Bearer', refresh_token: 'r1', expires_at: Date.now() - 1_000 });
    authMetaStore.save('h1', { tokenEndpoint: 'https://auth.example.com/token' });
    localStorage.setItem('mcp_clients', JSON.stringify({ h1: { client_id: 'c1' } }));

    // Refresh goes through global.fetch to the token endpoint.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'fresh', token_type: 'Bearer', expires_in: 3600 }),
    });
    global.fetch = fetchMock as any;

    const captured: { auth?: string } = {};
    McpHttpTransport._mockInvoke = captureHeaderMock(captured);

    await McpHttpTransport.initializeSession(CFG());
    await McpHttpTransport.sendRequest('h1', toolsListReq);

    expect(fetchMock).toHaveBeenCalledWith('https://auth.example.com/token', expect.objectContaining({ method: 'POST' }));
    expect(captured.auth).toBe('Bearer fresh');
    expect(tokenStore.load('h1')?.access_token).toBe('fresh');
  });

  it('falls back to the static config token when no OAuth token is stored', async () => {
    const captured: { auth?: string } = {};
    McpHttpTransport._mockInvoke = captureHeaderMock(captured);

    await McpHttpTransport.initializeSession(CFG({ auth: { token: 'static1', type: 'bearer' } }));
    await McpHttpTransport.sendRequest('h1', toolsListReq);

    expect(captured.auth).toBe('Bearer static1');
  });

  it('throws McpReauthRequiredError on a 401', async () => {
    const captured: { auth?: string } = {};
    McpHttpTransport._mockInvoke = captureHeaderMock(captured, 401);

    await McpHttpTransport.initializeSession(CFG());
    await expect(McpHttpTransport.sendRequest('h1', toolsListReq)).rejects.toBeInstanceOf(McpReauthRequiredError);
  });
});
