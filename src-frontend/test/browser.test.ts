import { describe, it, expect, beforeEach } from 'vitest';
import {
  browserSession,
  browserBus,
  isLocalhostUrl,
  BROWSER_EVENTS,
  type BrowserEvent,
} from '../services/browser';

describe('browser session foundation (#65)', () => {
  beforeEach(() => {
    // Reset mutable singleton state between tests so emissions/state don't leak.
    browserSession.currentUrl = '';
    browserSession.navUrl = '';
    browserSession.isPreviewOpen = false;
    browserSession.mode = 'iframe';
    browserSession.engineConnected = false;
    browserSession.lastSnapshotRefs = {};
  });

  describe('browserSession defaults', () => {
    it('initializes with safe defaults', () => {
      expect(browserSession.isPreviewOpen).toBe(false);
      expect(browserSession.mode).toBe('iframe');
      expect(browserSession.currentUrl).toBe('');
      expect(browserSession.navUrl).toBe('');
      expect(browserSession.engineConnected).toBe(false);
      expect(browserSession.lastSnapshotRefs).toEqual({});
    });

    it('setters mutate in place and emit the matching event', () => {
      const seen: string[] = [];
      const onLoaded = (p: any) => seen.push(`loaded:${p}`);
      const onSnapshot = (p: any) => seen.push(`snapshot:${Object.keys(p).join(',')}`);
      browserBus.on('loaded', onLoaded);
      browserBus.on('snapshot', onSnapshot);

      browserSession.setCurrentUrl('https://example.com');
      browserSession.setLastSnapshotRefs({ e1: { role: 'button', name: 'Submit' } });

      expect(browserSession.currentUrl).toBe('https://example.com');
      expect(browserSession.lastSnapshotRefs.e1.name).toBe('Submit');
      expect(seen).toEqual(['loaded:https://example.com', 'snapshot:e1']);

      browserBus.off('loaded', onLoaded);
      browserBus.off('snapshot', onSnapshot);
    });
  });

  describe('browserBus pub/sub', () => {
    it('round-trips a payload via on/emit', () => {
      let received: any = null;
      const cb = (p: any) => { received = p; };
      browserBus.on('console', cb);

      browserBus.emit('console', { level: 'log', text: 'hi' });
      expect(received).toEqual({ level: 'log', text: 'hi' });

      browserBus.off('console', cb);
    });

    it('stops delivering after off()', () => {
      let count = 0;
      const cb = () => { count += 1; };
      browserBus.on('audit', cb);

      browserBus.emit('audit', { action: 'navigate' });
      expect(count).toBe(1);

      browserBus.off('audit', cb);
      browserBus.emit('audit', { action: 'navigate' });
      expect(count).toBe(1); // unchanged after off
    });

    it('de-dupes identical listeners (Set semantics)', () => {
      let count = 0;
      const cb = () => { count += 1; };
      browserBus.on('screenshot', cb);
      browserBus.on('screenshot', cb); // duplicate registration is a no-op

      browserBus.emit('screenshot', null);
      expect(count).toBe(1);

      browserBus.off('screenshot', cb);
    });

    it('exposes the full readonly event catalogue', () => {
      const expected: BrowserEvent[] = [
        'navigate',
        'loaded',
        'snapshot',
        'console',
        'engine-status',
        'screenshot',
        'audit',
      ];
      expect([...BROWSER_EVENTS]).toEqual(expected);
    });
  });

  describe('isLocalhostUrl routing predicate', () => {
    it('is true for localhost and loopback URLs on any port', () => {
      expect(isLocalhostUrl('http://localhost:5173')).toBe(true);
      expect(isLocalhostUrl('http://127.0.0.1:3000')).toBe(true);
      expect(isLocalhostUrl('http://0.0.0.0:8080')).toBe(true);
      expect(isLocalhostUrl('http://[::1]:9000')).toBe(true);
      expect(isLocalhostUrl('https://localhost')).toBe(true);
    });

    it('is robust to URLs without a protocol', () => {
      expect(isLocalhostUrl('localhost:5173')).toBe(true);
      expect(isLocalhostUrl('127.0.0.1')).toBe(true);
    });

    it('is false for external origins', () => {
      expect(isLocalhostUrl('https://example.com')).toBe(false);
      expect(isLocalhostUrl('http://192.168.1.10:3000')).toBe(false);
      expect(isLocalhostUrl('')).toBe(false);
    });

    it('honors a configurable dev URL host', () => {
      // A non-loopback host that matches the configured dev URL counts as local.
      expect(isLocalhostUrl('http://devbox.local:5173', 'http://devbox.local:5173')).toBe(true);
      // ...but only that host.
      expect(isLocalhostUrl('http://other.local', 'http://devbox.local:5173')).toBe(false);
    });
  });
});
