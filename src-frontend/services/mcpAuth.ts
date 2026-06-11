/**
 * MCP OAuth 2.0 authentication — PKCE + metadata discovery
 * Implements the MCP auth spec: protected-resource metadata discovery,
 * dynamic client registration, PKCE (S256), loopback redirect, token lifecycle.
 */

import { secretStore } from './secretStore';
import { checkRateLimit, recordFailure, recordSuccess } from './rateLimiter';

export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
}

export interface OAuthTokens {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number; // unix ms, computed on receipt
}

export interface OAuthRedirectResult {
  code?: string;
  state?: string;
  error?: string;
}

// Loopback port range: 49152–49999 (dynamic/private, unlikely to be in use)
const REDIRECT_PORT_MIN = 49152;
const REDIRECT_PORT_MAX = 49999;

function randomPort(): number {
  return REDIRECT_PORT_MIN + Math.floor(Math.random() * (REDIRECT_PORT_MAX - REDIRECT_PORT_MIN));
}

// ─── PKCE ────────────────────────────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/** Generate a PKCE S256 verifier + challenge pair. */
export async function generatePkceChallenge(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64url(verifierBytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  return { verifier, challenge };
}

/** Generate a random opaque state token for CSRF protection. */
export function generateState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

// ─── Metadata discovery ───────────────────────────────────────────────────────

/** Discover the OAuth authorization server metadata for a given resource/issuer URL. */
export async function discoverAuthServer(resourceUrl: string): Promise<AuthServerMetadata> {
  const base = new URL(resourceUrl).origin;
  const candidates = [
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json() as Promise<AuthServerMetadata>;
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Could not discover OAuth authorization server at ${base}`);
}

// ─── Dynamic client registration ─────────────────────────────────────────────

export interface ClientCredentials {
  client_id: string;
  client_secret?: string;
}

// Client credentials may include a client_secret, so they live in the secret store.
async function loadClients(): Promise<Record<string, ClientCredentials>> {
  const raw = await secretStore.get('clients');
  return raw ? JSON.parse(raw) : {};
}

async function saveClient(serverId: string, creds: ClientCredentials): Promise<void> {
  const all = await loadClients();
  all[serverId] = creds;
  await secretStore.set('clients', JSON.stringify(all));
}

/** Register a dynamic client or return the cached credentials. */
export async function getOrRegisterClient(
  serverId: string,
  metadata: AuthServerMetadata,
  appName = 'Ollama GUI'
): Promise<ClientCredentials> {
  const cached = (await loadClients())[serverId];
  if (cached) return cached;

  if (!metadata.registration_endpoint) {
    // Server doesn't support dynamic registration — use a public client
    return { client_id: appName };
  }

  const port = randomPort();
  const res = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: appName,
      redirect_uris: [`http://127.0.0.1:${port}/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });

  if (!res.ok) throw new Error(`Dynamic client registration failed: ${res.statusText}`);
  const creds = (await res.json()) as ClientCredentials;
  saveClient(serverId, creds);
  return creds;
}

// ─── Token exchange ───────────────────────────────────────────────────────────

async function exchangeCode(opts: {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  verifier: string;
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.verifier,
  });

  const limit = checkRateLimit(`oauth:${opts.tokenEndpoint}`, 'oauth');
  if (!limit.allowed) {
    throw new Error(`Too many token requests — retry in ${Math.ceil(limit.retryAfterMs / 1000)}s.`);
  }

  const res = await fetch(opts.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    recordFailure(`oauth:${opts.tokenEndpoint}`);
    throw new Error(`Token exchange failed: ${res.statusText}`);
  }
  recordSuccess(`oauth:${opts.tokenEndpoint}`);
  const tokens = (await res.json()) as OAuthTokens;
  if (tokens.expires_in) {
    tokens.expires_at = Date.now() + tokens.expires_in * 1000;
  }
  return tokens;
}

async function refreshAccessToken(
  tokenEndpoint: string,
  refreshToken: string,
  clientId: string
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const limit = checkRateLimit(`oauth:${tokenEndpoint}`, 'oauth');
  if (!limit.allowed) {
    throw new Error(`Too many token requests — retry in ${Math.ceil(limit.retryAfterMs / 1000)}s.`);
  }

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    recordFailure(`oauth:${tokenEndpoint}`);
    throw new Error(`Token refresh failed: ${res.statusText}`);
  }
  recordSuccess(`oauth:${tokenEndpoint}`);
  const tokens = (await res.json()) as OAuthTokens;
  if (tokens.expires_in) {
    tokens.expires_at = Date.now() + tokens.expires_in * 1000;
  }
  return tokens;
}

// ─── Token store ─────────────────────────────────────────────────────────────

// OAuth tokens (incl. refresh tokens) are secrets — stored via the OS keychain /
// encrypted fallback, never localStorage. One secret entry per server.
export const tokenStore = {
  async save(serverId: string, tokens: OAuthTokens): Promise<void> {
    await secretStore.set(`tokens:${serverId}`, JSON.stringify(tokens));
  },
  async load(serverId: string): Promise<OAuthTokens | null> {
    const raw = await secretStore.get(`tokens:${serverId}`);
    return raw ? (JSON.parse(raw) as OAuthTokens) : null;
  },
  async clear(serverId: string): Promise<void> {
    await secretStore.delete(`tokens:${serverId}`);
  },
  isExpired(tokens: OAuthTokens): boolean {
    if (!tokens.expires_at) return false;
    return Date.now() >= tokens.expires_at - 60_000; // refresh 1 min early
  },
};

// ─── Auth metadata store (token endpoint per server, for refresh) ──────────────

const AUTH_META_KEY = 'mcp_auth_meta';

export const authMetaStore = {
  save(serverId: string, meta: { tokenEndpoint: string }): void {
    const all = JSON.parse(localStorage.getItem(AUTH_META_KEY) ?? '{}');
    all[serverId] = meta;
    localStorage.setItem(AUTH_META_KEY, JSON.stringify(all));
  },
  load(serverId: string): { tokenEndpoint: string } | null {
    const all = JSON.parse(localStorage.getItem(AUTH_META_KEY) ?? '{}');
    return all[serverId] ?? null;
  },
};

/**
 * Resolve a currently-valid OAuth access token for a server, refreshing if the
 * stored token is expired. Returns null when the server never authenticated.
 */
export async function getValidAccessToken(serverId: string): Promise<string | null> {
  const meta = authMetaStore.load(serverId);
  const client = (await loadClients())[serverId];
  if (meta?.tokenEndpoint && client?.client_id) {
    const fresh = await getValidTokens(serverId, meta.tokenEndpoint, client.client_id);
    return fresh?.access_token ?? null;
  }
  // No refresh metadata — return the stored token as-is if present.
  return (await tokenStore.load(serverId))?.access_token ?? null;
}

// ─── Full OAuth flow ──────────────────────────────────────────────────────────

/**
 * Run the full OAuth 2.1 + PKCE flow for an MCP server:
 * 1. Discover auth server
 * 2. Get/register client credentials
 * 3. Build auth URL with PKCE challenge
 * 4. Start loopback redirect listener (Rust)
 * 5. Open system browser
 * 6. Wait for redirect, exchange code for tokens
 * 7. Persist tokens
 */
export async function performOAuthFlow(serverId: string, serverUrl: string): Promise<OAuthTokens> {
  const metadata = await discoverAuthServer(serverUrl);
  const client = await getOrRegisterClient(serverId, metadata);
  // Persist what token refresh needs later (public clients aren't saved by getOrRegisterClient).
  saveClient(serverId, client);
  authMetaStore.save(serverId, { tokenEndpoint: metadata.token_endpoint });
  const { verifier, challenge } = await generatePkceChallenge();
  const state = generateState();
  const port = randomPort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', client.client_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  const { invoke } = await import('@tauri-apps/api/core');
  const { open } = await import('@tauri-apps/plugin-opener');

  // Start listener before opening browser so we don't miss the redirect
  const listenerPromise = invoke<OAuthRedirectResult>('start_oauth_redirect_listener', { port });
  await open(authUrl.toString());

  const redirect = await listenerPromise;
  if (redirect.error) throw new Error(`OAuth error: ${redirect.error}`);
  if (redirect.state !== state) throw new Error('OAuth state mismatch — possible CSRF');
  if (!redirect.code) throw new Error('No authorization code in redirect');

  const tokens = await exchangeCode({
    tokenEndpoint: metadata.token_endpoint,
    code: redirect.code,
    redirectUri,
    clientId: client.client_id,
    verifier,
  });

  await tokenStore.save(serverId, tokens);
  return tokens;
}

/**
 * Return valid tokens for a server, refreshing if expired.
 * Returns null if not authenticated.
 */
export async function getValidTokens(
  serverId: string,
  tokenEndpoint: string,
  clientId: string
): Promise<OAuthTokens | null> {
  const tokens = await tokenStore.load(serverId);
  if (!tokens) return null;

  if (!tokenStore.isExpired(tokens)) return tokens;

  if (!tokens.refresh_token) {
    await tokenStore.clear(serverId);
    return null;
  }

  try {
    const fresh = await refreshAccessToken(tokenEndpoint, tokens.refresh_token, clientId);
    await tokenStore.save(serverId, fresh);
    return fresh;
  } catch {
    await tokenStore.clear(serverId);
    return null;
  }
}
