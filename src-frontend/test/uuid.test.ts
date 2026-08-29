import { describe, it, expect, afterEach } from 'vitest';
import { uuid } from '../services/uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('uuid (#10.15 Safari 13 runtime safety)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('matches RFC 4122 v4 format', () => {
    const id = uuid();
    expect(id).toMatch(V4);
    expect(id).toHaveLength(36);
  });

  it('is unique across calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuid()));
    expect(ids.size).toBe(1000);
  });

  it('sets version nibble to 4 and variant bits to 10xx', () => {
    const id = uuid();
    expect(id).toMatch(/-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-/);
  });

  // Force the getRandomValues branch (Safari 13 path where randomUUID is missing).
  it('works via getRandomValues when crypto.randomUUID is missing', () => {
    const Native = crypto.randomUUID;
    // @ts-expect-error - strip the native method to force the shim
    delete crypto.randomUUID;
    try {
      expect(uuid()).toMatch(V4);
    } finally {
      crypto.randomUUID = Native;
    }
  });

  // Force the Math.random fallback (no crypto at all).
  it('works via Math.random when crypto is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(uuid()).toMatch(V4);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });
});
