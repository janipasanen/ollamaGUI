// @vitest-environment node
/**
 * Boot-compatibility guards (#552).
 *
 * The white-window failure had no test to catch it because it is not a runtime
 * bug: RegExp lookbehind is an ECMAScript *Early Error*, so on WebKit < 16.4
 * the whole boot chunk fails to PARSE and not one line of our code runs. There
 * is nothing to assert at runtime — the checks that matter are on the sources
 * and on the build configuration, which is what this file pins.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deriveProjectName } from '../services/projectNaming';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('boot compatibility — source (#552)', () => {
  // Walks every source file, so it is I/O-bound and can exceed vitest's 5s
  // default on a cold page cache — especially on an external drive.
  it('ships no RegExp lookbehind of our own in src-frontend', { timeout: 60_000 }, () => {
    // Lookbehind cannot be transpiled away by any bundler; one occurrence in
    // the boot path is a blank window on every Mac below macOS 13.3.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { walk(rel); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        // This file necessarily contains the pattern as a string literal.
        if (rel.endsWith('bootCompat.test.ts')) continue;
        const src = read(rel);
        if (src.includes('(?<=') || src.includes('(?<!')) offenders.push(rel);
      }
    };
    walk('src-frontend');
    expect(offenders).toEqual([]);
  });

  it('keeps deriveProjectName splitting on the first sentence', () => {
    // The lookbehind removal must not change behaviour: everything after the
    // first sentence break is dropped. A trailing '.' is then stripped by the
    // punctuation trim that follows, so it does not survive into the name —
    // '?' is not in that trim set and does.
    expect(deriveProjectName('Fix the parser. Then ship it.')).toBe('Fix the parser');
    expect(deriveProjectName('One sentence only')).toBe('One sentence only');
    expect(deriveProjectName('Is it broken? Yes.')).toBe('Is it broken?');
    // A period that is not a sentence break (no following space) stays put.
    expect(deriveProjectName('Update vite.config.ts')).toBe('Update vite.config.ts');
  });
});

describe('boot compatibility — build configuration (#552)', () => {
  it('pins an explicit build target instead of inheriting Vite\'s moving default', () => {
    // Vite's `baseline-widely-available` default moves with each release, so
    // an upgrade could silently raise the floor again with no diff to review.
    const cfg = read('vite.config.ts');
    expect(cfg).toMatch(/build:\s*\{/);
    expect(cfg).toMatch(/target:\s*\[/);
    expect(cfg).toContain('safari16.4');
  });

  it('declares a macOS floor matching the JavaScript the bundle needs', () => {
    // Without this the .app installs on Macs that cannot parse its own code
    // and shows a white window instead of an OS-level refusal.
    const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
    expect(conf.bundle?.macOS?.minimumSystemVersion).toBe('13.3');
  });

  it('reports a boot failure instead of rendering a blank page', () => {
    // The React error boundary lives inside App.tsx, so it cannot catch a
    // failure of the module graph it is part of. This inline reporter can.
    const html = read('index.html');
    expect(html).toContain('boot-error');
    expect(html).toMatch(/addEventListener\(\s*['"]error['"]/);
    expect(html).toMatch(/addEventListener\(\s*['"]unhandledrejection['"]/);
  });
});

describe('boot compatibility — built output (#552)', () => {
  const distDir = join(ROOT, 'dist', 'assets');
  // Only meaningful after `npm run build`; skipped in a clean checkout.
  const built = existsSync(distDir)
    ? readdirSync(distDir).filter(f => /^index-.*\.js$/.test(f))
    : [];

  // Reads multi-megabyte bundles from disk; same cold-cache caveat as above.
  it.skipIf(built.length === 0)('has no lookbehind we introduced in the boot chunk', { timeout: 60_000 }, () => {
    // The remark-gfm occurrence is expected and sets the documented floor;
    // ours must not come back. Assert on the exact shape of our old regex.
    for (const file of built) {
      const src = readFileSync(join(distDir, file), 'utf8');
      expect(src).not.toContain('(?<=[.!?])');
    }
  });
});
