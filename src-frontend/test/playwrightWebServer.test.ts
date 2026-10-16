import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// #613: CI must be able to boot the production artifact. playwright.config.ts
// picks the webServer command from PW_TARGET; default is the unbundled dev
// server, `preview` builds+serves the bundle so the shipped artifact is
// exercised (not just dev ESM).
describe('playwright webServer PW_TARGET switch (#613)', () => {
  let prev: string | undefined;

  beforeEach(() => { prev = process.env.PW_TARGET; });
  afterEach(() => {
    if (prev === undefined) delete process.env.PW_TARGET;
    else process.env.PW_TARGET = prev;
  });

  /** Load the config fresh under a given PW_TARGET (reset module registry). */
  async function load(pwTarget?: string) {
    if (pwTarget === undefined) delete process.env.PW_TARGET;
    else process.env.PW_TARGET = pwTarget;
    vi.resetModules();
    const mod = await import('../../playwright.config.ts');
    return mod.default as { webServer: { command: string; reuseExistingServer: boolean; timeout: number } };
  }

  it('serves the dev server by default (dev-only path)', async () => {
    const cfg = await load(undefined);
    expect(cfg.webServer.command).toBe('npm run dev');
  });

  it('builds and serves the production bundle when PW_TARGET=preview', async () => {
    const cfg = await load('preview');
    expect(cfg.webServer.command).toContain('npm run build');
    expect(cfg.webServer.command).toContain('npm run preview');
    // Preview defaults to :4173; pin it to the CI/expected port.
    expect(cfg.webServer.command).toContain('--port 5173');
    expect(cfg.webServer.command).toContain('--strictPort');
  });

  it('reuseExistingServer: fresh in CI, reuse locally, always fresh for preview', async () => {
    // Local dev: reuse an already-running server.
    delete process.env.CI;
    expect(await load(undefined)).toMatchObject({ webServer: { reuseExistingServer: true } });
    // CI: always start a fresh server.
    process.env.CI = 'true';
    expect(await load(undefined)).toMatchObject({ webServer: { reuseExistingServer: false } });
    // Preview: always build-then-serve, never reuse.
    expect(await load('preview')).toMatchObject({ webServer: { reuseExistingServer: false } });
    delete process.env.CI;
  });
});
