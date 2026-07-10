import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generatePkceChallenge,
  generateState,
  discoverAuthServer,
  tokenStore,
  authMetaStore,
  oauthErrorFromResponse,
  getOrRegisterClient,
  exchangeCode,
  refreshAccessToken,
} from '../services/mcpAuth';
import { secretStore } from '../services/secretStore';

// ─── PKCE ────────────────────────────────────────────────────────────────────

describe('generatePkceChallenge', () => {
  it('returns a verifier and challenge', async () => {
    const { verifier, challenge } = await generatePkceChallenge();
    expect(typeof verifier).toBe('string');
    expect(typeof challenge).toBe('string');
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('verifier uses base64url characters only', async () => {
    const { verifier } = await generatePkceChallenge();
    // base64url: A-Z a-z 0-9 - _  (no + / =)
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('challenge is the SHA-256 of the verifier (base64url)', async () => {
    const { verifier, challenge } = await generatePkceChallenge();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    expect(challenge).toBe(expected);
  });

  it('produces unique verifiers on each call', async () => {
    const a = await generatePkceChallenge();
    const b = await generatePkceChallenge();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe('generateState', () => {
  it('returns a non-empty base64url string', () => {
    const state = generateState();
    expect(state).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(state.length).toBeGreaterThan(0);
  });

  it('returns different values on each call', () => {
    const states = new Set(Array.from({ length: 10 }, () => generateState()));
    expect(states.size).toBe(10);
  });
});

// ─── Metadata discovery ───────────────────────────────────────────────────────

describe('discoverAuthServer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns metadata from oauth-authorization-server endpoint', async () => {
    const meta = {
      issuer: 'https://auth.example.com',
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => meta }),
    );

    const result = await discoverAuthServer('https://mcp.example.com/api');
    expect(result.authorization_endpoint).toBe('https://auth.example.com/authorize');
    expect(result.token_endpoint).toBe('https://auth.example.com/token');
  });

  it('falls back to openid-configuration when first endpoint fails', async () => {
    const meta = {
      issuer: 'https://id.example.com',
      authorization_endpoint: 'https://id.example.com/auth',
      token_endpoint: 'https://id.example.com/token',
    };

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true, json: async () => meta }),
    );

    const result = await discoverAuthServer('https://id.example.com');
    expect(result.issuer).toBe('https://id.example.com');
  });

  it('throws when both endpoints fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(discoverAuthServer('https://noauth.example.com')).rejects.toThrow(
      /Could not discover/,
    );
  });
});

// ─── Token store ─────────────────────────────────────────────────────────────

describe('tokenStore', () => {
  const TEST_ID = 'test_server_1';

  beforeEach(async () => {
    await tokenStore.clear(TEST_ID);
  });

  it('saves and loads tokens', async () => {
    const tokens = { access_token: 'abc', token_type: 'Bearer' };
    await tokenStore.save(TEST_ID, tokens);
    expect(await tokenStore.load(TEST_ID)).toMatchObject(tokens);
  });

  it('returns null for unknown server', async () => {
    expect(await tokenStore.load('nonexistent_server')).toBeNull();
  });

  it('does not store tokens in localStorage (secret store only)', async () => {
    await tokenStore.save(TEST_ID, { access_token: 'supersecret', token_type: 'Bearer' });
    const dump = JSON.stringify(localStorage);
    expect(dump).not.toContain('supersecret');
  });

  it('clears tokens', async () => {
    await tokenStore.save(TEST_ID, { access_token: 'xyz', token_type: 'Bearer' });
    await tokenStore.clear(TEST_ID);
    expect(await tokenStore.load(TEST_ID)).toBeNull();
  });

  it('isExpired returns false for tokens without expires_at', () => {
    const tokens = { access_token: 'abc', token_type: 'Bearer' };
    expect(tokenStore.isExpired(tokens)).toBe(false);
  });

  it('isExpired returns true when expires_at is in the past', () => {
    const tokens = { access_token: 'abc', token_type: 'Bearer', expires_at: Date.now() - 1000 };
    expect(tokenStore.isExpired(tokens)).toBe(true);
  });

  it('isExpired returns false when expires_at is well in the future', () => {
    const tokens = { access_token: 'abc', token_type: 'Bearer', expires_at: Date.now() + 120_000 };
    expect(tokenStore.isExpired(tokens)).toBe(false);
  });
});


// ── #452: authMetaStore must handle corrupted localStorage ───────────────────

describe('authMetaStore corrupted localStorage (#452)', () => {
  it('load returns null when localStorage is corrupted', () => {
    localStorage.setItem('mcp_auth_meta', '{not valid json');
    expect(authMetaStore.load('server1')).toBeNull();
  });

  it('save does not crash when localStorage is corrupted', () => {
    localStorage.setItem('mcp_auth_meta', '{not valid json');
    authMetaStore.save('server1', { tokenEndpoint: 'https://example.com/token' });
    // After save, the data should be valid (save replaces corrupted data)
    const result = authMetaStore.load('server1');
    expect(result).toEqual({ tokenEndpoint: 'https://example.com/token' });
  });

  it('load returns null for unknown serverId', () => {
    localStorage.removeItem('mcp_auth_meta');
    expect(authMetaStore.load('unknown')).toBeNull();
  });

  it('save and load round-trip normally', () => {
    localStorage.removeItem('mcp_auth_meta');
    authMetaStore.save('s1', { tokenEndpoint: 'https://example.com/token' });
    authMetaStore.save('s2', { tokenEndpoint: 'https://other.com/token' });
    expect(authMetaStore.load('s1')).toEqual({ tokenEndpoint: 'https://example.com/token' });
    expect(authMetaStore.load('s2')).toEqual({ tokenEndpoint: 'https://other.com/token' });
  });
});

// ── #460: OAuth non-ok responses must surface body error detail ─────────────

describe('OAuth error surfacing (#460)', () => {
  let origFetch: typeof global.fetch;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  it('oauthErrorFromResponse extracts error_description (#460)', async () => {
    const res = { statusText: 'Bad Request', json: async () => ({ error: 'invalid_grant', error_description: 'The refresh token is invalid or expired.' }) } as any;
    const err = await oauthErrorFromResponse(res, 'Token refresh failed');
    expect(err.message).toBe('Token refresh failed: The refresh token is invalid or expired.');
  });

  it('oauthErrorFromResponse falls back to error when no error_description (#460)', async () => {
    const res = { statusText: 'Bad Request', json: async () => ({ error: 'invalid_client' }) } as any;
    const err = await oauthErrorFromResponse(res, 'Token exchange failed');
    expect(err.message).toBe('Token exchange failed: invalid_client');
  });

  it('oauthErrorFromResponse falls back to statusText when body has no error fields (#460)', async () => {
    const res = { statusText: 'Internal Server Error', json: async () => ({ unrelated: true }) } as any;
    const err = await oauthErrorFromResponse(res, 'Registration failed');
    expect(err.message).toBe('Registration failed: Internal Server Error');
  });

  it('oauthErrorFromResponse falls back to statusText when json() throws (#460)', async () => {
    const res = { statusText: 'Service Unavailable', json: async () => { throw new SyntaxError('nope'); } } as any;
    const err = await oauthErrorFromResponse(res, 'Token exchange failed');
    expect(err.message).toBe('Token exchange failed: Service Unavailable');
  });

  it('getOrRegisterClient surfaces body error on non-ok (#460)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required' }),
    }) as any;
    const meta = {
      issuer: 'https://auth.example.com',
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      registration_endpoint: 'https://auth.example.com/register',
    };
    await expect(getOrRegisterClient('srv1', meta)).rejects.toThrow('redirect_uris is required');
  });

  it('exchangeCode surfaces body error on non-ok (#460)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ error: 'invalid_grant', error_description: 'Authorization code expired' }),
    }) as any;
    await expect(
      exchangeCode({ tokenEndpoint: 'https://auth.example.com/token', code: 'abc', redirectUri: 'http://127.0.0.1:49152/callback', clientId: 'test-client', verifier: 'v123' }),
    ).rejects.toThrow('Authorization code expired');
  });

  it('refreshAccessToken surfaces body error on non-ok (#460)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ error: 'invalid_grant', error_description: 'refresh token revoked' }),
    }) as any;
    await expect(
      refreshAccessToken('https://auth.example.com/token', 'rt-abc', 'test-client'),
    ).rejects.toThrow('refresh token revoked');
  });
});

// ── #465: corrupted secretStore data must not crash MCP auth ─────────────────

describe('corrupted secretStore data handling (#465)', () => {
  beforeEach(() => { secretStore._clearMemory(); });
  afterEach(() => { secretStore._clearMemory(); });

  it('tokenStore.load returns null on corrupted token data (#465)', async () => {
    await secretStore.set('tokens:srv1', '{not valid json');
    const result = await tokenStore.load('srv1');
    expect(result).toBeNull();
  });

  it('tokenStore.load returns valid tokens on well-formed data (#465)', async () => {
    await secretStore.set('tokens:srv2', JSON.stringify({ access_token: 'abc', token_type: 'Bearer', expires_at: Date.now() + 3600_000 }));
    const result = await tokenStore.load('srv2');
    expect(result?.access_token).toBe('abc');
  });

  it('tokenStore.load returns null when no data stored (#465)', async () => {
 const result = await tokenStore.load('never-stored');
    expect(result).toBeNull();
  });

  it('getOrRegisterClient re-registers when client data is corrupted (#465)', async () => {
    await secretStore.set('clients', '{corrupted');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ client_id: 'new-client', client_secret: 'secret' }),
    }) as any;
    const meta = {
      issuer: 'https://auth.example.com',
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      registration_endpoint: 'https://auth.example.com/register',
    };
    const result = await getOrRegisterClient('srv3', meta);
    expect(result.client_id).toBe('new-client');
  });
});
