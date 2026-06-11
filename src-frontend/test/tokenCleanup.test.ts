import { describe, it, expect, beforeEach } from 'vitest';
import { tokenStore, type OAuthTokens } from '../services/mcpAuth';
import { secretStore } from '../services/secretStore';

beforeEach(() => {
  secretStore._clearMemory();
});

const expired = (refreshable: boolean): OAuthTokens => ({
  access_token: 'a', token_type: 'Bearer',
  refresh_token: refreshable ? 'r' : undefined,
  expires_at: 1000, // far in the past
});

describe('tokenStore.cleanupExpired (#34)', () => {
  it('clears an expired, non-refreshable token', async () => {
    await tokenStore.save('s1', expired(false));
    expect(await tokenStore.cleanupExpired('s1')).toBe(true);
    expect(await tokenStore.load('s1')).toBeNull();
  });

  it('keeps an expired token that has a refresh token', async () => {
    await tokenStore.save('s2', expired(true));
    expect(await tokenStore.cleanupExpired('s2')).toBe(false);
    expect(await tokenStore.load('s2')).not.toBeNull();
  });

  it('keeps a still-valid token', async () => {
    await tokenStore.save('s3', { access_token: 'a', token_type: 'Bearer', expires_at: Date.now() + 3_600_000 });
    expect(await tokenStore.cleanupExpired('s3')).toBe(false);
    expect(await tokenStore.load('s3')).not.toBeNull();
  });

  it('returns false when no token exists', async () => {
    expect(await tokenStore.cleanupExpired('missing')).toBe(false);
  });
});

describe('tokenStore.cleanupAllExpired (#34)', () => {
  it('clears only the expired non-refreshable tokens and reports them', async () => {
    await tokenStore.save('a', expired(false));
    await tokenStore.save('b', expired(true));
    await tokenStore.save('c', { access_token: 'a', token_type: 'Bearer', expires_at: Date.now() + 3_600_000 });
    const cleared = await tokenStore.cleanupAllExpired(['a', 'b', 'c']);
    expect(cleared).toEqual(['a']);
    expect(await tokenStore.load('a')).toBeNull();
    expect(await tokenStore.load('b')).not.toBeNull();
    expect(await tokenStore.load('c')).not.toBeNull();
  });
});
