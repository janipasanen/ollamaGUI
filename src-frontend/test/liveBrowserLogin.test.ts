// @vitest-environment node
/**
 * Opt-in end-to-end check that an agent can actually complete a sign-in and
 * see the traffic it produced (#627).
 *
 * Skipped unless LIVE_BROWSER=1, because it needs a Chromium install and a
 * display. It must never run in CI or in a plain `npm test`.
 *
 *   LIVE_BROWSER=1 npx vitest run src-frontend/test/liveBrowserLogin.test.ts
 *
 * What it proves that the mocked specs cannot: that navigate → type → click →
 * read-network is a working sequence against a real page, and that the POST a
 * login produces is visible with its status. "The model can log in to sites"
 * is the claim; this is the thing that tests it rather than assuming it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';

const LIVE = process.env.LIVE_BROWSER === '1';
const PORT = Number(process.env.LIVE_BROWSER_PORT ?? 4319);
const BASE = `http://127.0.0.1:${PORT}`;

/** A login page and a handler that only accepts one credential pair. */
function startSite(): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const ok = body.includes('user=ada') && body.includes('pass=lovelace');
        res.writeHead(ok ? 200 : 401, { 'content-type': 'text/html' });
        res.end(ok ? '<h1>Welcome, ada</h1>' : '<h1>Invalid credentials</h1>');
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Login</title>
      <form id="f" method="POST" action="/login">
        <label>Username <input name="user" id="user"></label>
        <label>Password <input name="pass" id="pass" type="password"></label>
        <button type="submit" id="submit">Sign in</button>
      </form>`);
  });
  return new Promise(resolve => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

let server: Server | undefined;

beforeAll(async () => { if (LIVE) server = await startSite(); });
afterAll(async () => {
  if (server) await new Promise<void>(r => server!.close(() => r()));
  if (LIVE) {
    const { _mocks, registerBrowserTools } = await import('../services/browser-tools');
    void _mocks; void registerBrowserTools;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('browser_engine_stop').catch(() => {});
  }
});

describe.skipIf(!LIVE)('LIVE — agent signs in and inspects the traffic (#627)', () => {
  it('navigates, types, submits, and sees the login POST', async () => {
    const { registerBrowserTools } = await import('../services/browser-tools');
    const { toolRegistry } = await import('../services/tools');
    const { _resetNetworkForTests } = await import('../services/browserNetwork');
    _resetNetworkForTests();
    registerBrowserTools(async () => true);

    const run = (name: string, args: Record<string, unknown> = {}) =>
      toolRegistry.getTool(name)!.execute(args) as Promise<any>;

    await run('browser_navigate', { url: BASE });
    const snap = await run('browser_snapshot');
    expect(JSON.stringify(snap)).toMatch(/Sign in/i);

    // Fill the form by accessibility ref, the way the agent would.
    const refs: Record<string, unknown> = (snap.refs ?? {}) as any;
    const userRef = Object.keys(refs).find(k => /user/i.test(JSON.stringify(refs[k])));
    const passRef = Object.keys(refs).find(k => /pass/i.test(JSON.stringify(refs[k])));
    expect(userRef, 'username field must be reachable by ref').toBeTruthy();
    expect(passRef, 'password field must be reachable by ref').toBeTruthy();

    await run('browser_type', { ref: userRef, text: 'ada' });
    await run('browser_type', { ref: passRef, text: 'lovelace', submit: true });

    // The whole point: the POST and its status must be visible.
    const net = await run('browser_read_network', { filter: '/login', method: 'POST' });
    expect(net.count).toBeGreaterThan(0);
    expect(net.requests[0].status).toBe(200);

    const after = await run('browser_snapshot');
    expect(JSON.stringify(after)).toMatch(/Welcome, ada/i);
  }, 180_000);

  it('sees a rejected sign-in as a 401 rather than silence', async () => {
    const { registerBrowserTools } = await import('../services/browser-tools');
    const { toolRegistry } = await import('../services/tools');
    const { _resetNetworkForTests } = await import('../services/browserNetwork');
    _resetNetworkForTests();
    registerBrowserTools(async () => true);
    const run = (name: string, args: Record<string, unknown> = {}) =>
      toolRegistry.getTool(name)!.execute(args) as Promise<any>;

    await run('browser_navigate', { url: BASE });
    const snap = await run('browser_snapshot');
    const refs: Record<string, unknown> = (snap.refs ?? {}) as any;
    const userRef = Object.keys(refs).find(k => /user/i.test(JSON.stringify(refs[k])));
    const passRef = Object.keys(refs).find(k => /pass/i.test(JSON.stringify(refs[k])));

    await run('browser_type', { ref: userRef, text: 'ada' });
    await run('browser_type', { ref: passRef, text: 'wrong', submit: true });

    const net = await run('browser_read_network', { filter: '/login', status: '4xx' });
    expect(net.count).toBeGreaterThan(0);
    expect(net.requests[0].status).toBe(401);
  }, 180_000);
});
