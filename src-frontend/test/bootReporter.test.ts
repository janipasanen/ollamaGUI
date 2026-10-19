/**
 * The boot-failure reporter in index.html (#552).
 *
 * It exists to turn a blank white window into a readable message. Its far more
 * dangerous failure mode is the opposite one: hiding a WORKING app behind an
 * error overlay. That regression shipped once — a missing image fired an
 * 'error' event with no .message, caught in the capture phase, and rendered
 * "Unknown error" over a fully mounted UI — so these tests pin the boundary.
 *
 * The script is extracted from index.html and evaluated against a jsdom DOM,
 * which keeps the real shipped source under test rather than a copy of it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');

/** The reporter is the last inline <script> in the document. */
function reporterSource(): string {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const src = scripts.find(s => s.includes('boot-error'));
  if (!src) throw new Error('boot reporter script not found in index.html');
  return src;
}

/** Recreate the parts of index.html the reporter touches, then run it. */
function bootWithReporter() {
  document.body.innerHTML = '<div id="root"></div>';
  // eslint-disable-next-line no-new-func
  new Function(reporterSource())();
}

// The overlay is built from script (no <style>/markup in the document) so that
// Tauri never adds a style-src nonce — see the comment in index.html.
const isShown = () => !!document.getElementById('boot-error');
const detail = () => document.getElementById('boot-error-detail')?.textContent ?? '';
const hint = () => document.getElementById('boot-error-hint')?.textContent ?? '';

/** Mount something into #root, the way React would. */
function mountApp() {
  document.getElementById('root')!.appendChild(document.createElement('div'));
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('boot reporter — reports genuine boot failures (#552)', () => {
  it('shows a macOS-too-old message for a parse error before mount', () => {
    bootWithReporter();
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'SyntaxError: Invalid regular expression: invalid group specifier name',
      filename: 'http://localhost/assets/index.js',
      lineno: 1,
    }));
    expect(isShown()).toBe(true);
    expect(hint()).toMatch(/newer macOS/i);
    expect(detail()).toContain('SyntaxError');
  });

  it('shows a generic message for a non-syntax throw before mount', () => {
    bootWithReporter();
    window.dispatchEvent(new ErrorEvent('error', { message: 'TypeError: x is not a function' }));
    expect(isShown()).toBe(true);
    expect(hint()).toMatch(/failed to load/i);
  });

  it('reports a boot that renders nothing at all', () => {
    bootWithReporter();
    vi.advanceTimersByTime(20_000);
    expect(isShown()).toBe(true);
    expect(detail()).toMatch(/rendered nothing/i);
  });
});

describe('boot reporter — never hides a working app (#552 regression)', () => {
  it('ignores a failed resource load, which carries no message', () => {
    // The exact regression: a 404 on an icon or lazy chunk fired an 'error'
    // event whose target is the element, not window, and whose message is
    // empty — surfacing as "Unknown error" over a working UI.
    bootWithReporter();
    const img = document.createElement('img');
    document.body.appendChild(img);
    const e = new Event('error', { bubbles: false });
    Object.defineProperty(e, 'target', { value: img });
    window.dispatchEvent(e);
    expect(isShown()).toBe(false);
  });

  it('ignores an error event with no message', () => {
    bootWithReporter();
    window.dispatchEvent(new ErrorEvent('error', { message: '' }));
    expect(isShown()).toBe(false);
  });

  it('stays quiet once the app has mounted, even on a later throw', () => {
    bootWithReporter();
    mountApp();
    window.dispatchEvent(new ErrorEvent('error', { message: 'TypeError: late failure' }));
    expect(isShown()).toBe(false);
  });

  it('stays quiet on a rejected promise after mount', () => {
    bootWithReporter();
    mountApp();
    const e: any = new Event('unhandledrejection');
    e.reason = new Error('a fetch failed');
    window.dispatchEvent(e);
    expect(isShown()).toBe(false);
  });

  it('does not fire the no-render timeout when the app mounted in time', () => {
    bootWithReporter();
    mountApp();
    vi.advanceTimersByTime(60_000);
    expect(isShown()).toBe(false);
  });

  it('reports only the first failure', () => {
    bootWithReporter();
    window.dispatchEvent(new ErrorEvent('error', { message: 'SyntaxError: first' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'TypeError: second' }));
    expect(detail()).toContain('first');
    expect(detail()).not.toContain('second');
  });
});
