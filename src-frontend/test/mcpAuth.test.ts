import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generatePkceChallenge,
  generateState,
  discoverAuthServer,
  tokenStore,
} from '../services/mcpAuth';

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

  beforeEach(() => {
    tokenStore.clear(TEST_ID);
  });

  it('saves and loads tokens', () => {
    const tokens = { access_token: 'abc', token_type: 'Bearer' };
    tokenStore.save(TEST_ID, tokens);
    expect(tokenStore.load(TEST_ID)).toMatchObject(tokens);
  });

  it('returns null for unknown server', () => {
    expect(tokenStore.load('nonexistent_server')).toBeNull();
  });

  it('clears tokens', () => {
    tokenStore.save(TEST_ID, { access_token: 'xyz', token_type: 'Bearer' });
    tokenStore.clear(TEST_ID);
    expect(tokenStore.load(TEST_ID)).toBeNull();
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
