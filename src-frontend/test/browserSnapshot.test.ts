import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseSnapshotRefs,
  updateSessionSnapshot,
  onSnapshot,
} from '../services/browserSnapshot';
import { browserSession, browserBus } from '../services/browser';

describe('browserSnapshot AX-outline parsing (#73)', () => {
  beforeEach(() => {
    // Reset the mutable session singleton so emissions/state don't leak across
    // tests (mirrors browser.test.ts conventions).
    browserSession.lastSnapshotRefs = {};
  });

  describe('parseSnapshotRefs', () => {
    it('parses a single actionable ref line', () => {
      const refs = parseSnapshotRefs('- textbox "Email" [ref=e5]');
      expect(refs).toEqual({ e5: { role: 'textbox', name: 'Email' } });
    });

    it('handles multiple refs in a nested outline, preserving role/name', () => {
      const outline = [
        '- form "Login"',
        '  - heading "Sign in"',
        '  - textbox "Email" [ref=e1]',
        '  - textbox "***" [ref=e2]',
        '  - button "Sign in" [ref=e3]',
      ].join('\n');

      const refs = parseSnapshotRefs(outline);
      expect(refs).toEqual({
        e1: { role: 'textbox', name: 'Email' },
        // The redacted placeholder is preserved verbatim.
        e2: { role: 'textbox', name: '***' },
        e3: { role: 'button', name: 'Sign in' },
      });
    });

    it('ignores non-ref lines (context headings, landmarks, blanks)', () => {
      const outline = [
        '- main "Home"',
        '',
        '  - heading "Welcome"',
        '  - link "Docs" [ref=e7]',
        'not a list line at all',
      ].join('\n');

      const refs = parseSnapshotRefs(outline);
      // Only the single actionable link survives.
      expect(refs).toEqual({ e7: { role: 'link', name: 'Docs' } });
      expect(Object.keys(refs)).toEqual(['e7']);
    });

    it('returns an empty map for empty/blank input', () => {
      expect(parseSnapshotRefs('')).toEqual({});
      expect(parseSnapshotRefs('\n\n')).toEqual({});
    });

    it('handles an empty (fully redacted to empty) name', () => {
      const refs = parseSnapshotRefs('- textbox "" [ref=e9]');
      expect(refs).toEqual({ e9: { role: 'textbox', name: '' } });
    });
  });

  describe('updateSessionSnapshot', () => {
    it('stores the parsed refs on the session and emits "snapshot"', () => {
      let emitted: any = null;
      const cb = (p: any) => {
        emitted = p;
      };
      browserBus.on('snapshot', cb);

      const result = updateSessionSnapshot(
        ['- textbox "Email" [ref=e1]', '- button "Go" [ref=e2]'].join('\n'),
      );

      const expected = {
        e1: { role: 'textbox', name: 'Email' },
        e2: { role: 'button', name: 'Go' },
      };
      // Returned map, stored session state, and emitted payload all agree.
      expect(result).toEqual(expected);
      expect(browserSession.lastSnapshotRefs).toEqual(expected);
      expect(emitted).toEqual(expected);

      browserBus.off('snapshot', cb);
    });

    it('clearing with an outline that has no refs publishes an empty map', () => {
      // First seed a non-empty snapshot...
      updateSessionSnapshot('- button "Go" [ref=e1]');
      expect(Object.keys(browserSession.lastSnapshotRefs)).toEqual(['e1']);

      // ...then a context-only outline should reset it to empty.
      updateSessionSnapshot('- heading "Just a title"');
      expect(browserSession.lastSnapshotRefs).toEqual({});
    });
  });

  describe('onSnapshot subscription helper', () => {
    it('invokes the callback on publish and unsubscribes cleanly', () => {
      const seen: Array<Record<string, unknown>> = [];
      const unsubscribe = onSnapshot((refs) => seen.push(refs));

      updateSessionSnapshot('- link "A" [ref=e1]');
      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual({ e1: { role: 'link', name: 'A' } });

      unsubscribe();
      updateSessionSnapshot('- link "B" [ref=e1]');
      // No further deliveries after unsubscribe.
      expect(seen).toHaveLength(1);
    });
  });
});
