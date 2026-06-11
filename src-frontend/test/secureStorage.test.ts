import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptString,
  decryptString,
  isEncryptedPayload,
  secureWipe,
  secureWipeAll,
} from '../services/secureStorage';

function makeStorage(): Storage {
  const data: Record<string, string> = {};
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
    clear: () => { Object.keys(data).forEach(k => delete data[k]); },
    get length() { return Object.keys(data).length; },
    key: (i) => Object.keys(data)[i] ?? null,
  } as Storage;
}

describe('encryptString / decryptString (#38)', () => {
  it('round-trips a plaintext string', async () => {
    const payload = await encryptString('secret chat history', 'hunter2');
    const back = await decryptString(payload, 'hunter2');
    expect(back).toBe('secret chat history');
  });

  it('produces different ciphertext each time (random IV/salt)', async () => {
    const a = await encryptString('same', 'pw');
    const b = await encryptString('same', 'pw');
    expect(a.data).not.toBe(b.data);
    expect(a.iv).not.toBe(b.iv);
  });

  it('fails to decrypt with the wrong passphrase', async () => {
    const payload = await encryptString('top secret', 'right');
    await expect(decryptString(payload, 'wrong')).rejects.toBeDefined();
  });

  it('round-trips unicode and long content', async () => {
    const text = '日本語 — café — 🔐 '.repeat(100);
    const payload = await encryptString(text, 'pw');
    expect(await decryptString(payload, 'pw')).toBe(text);
  });

  it('payload carries version, salt, iv, data', async () => {
    const p = await encryptString('x', 'pw');
    expect(p.v).toBe(1);
    expect(typeof p.salt).toBe('string');
    expect(typeof p.iv).toBe('string');
    expect(typeof p.data).toBe('string');
  });
});

describe('isEncryptedPayload (#38)', () => {
  it('recognizes a real payload', async () => {
    const p = await encryptString('x', 'pw');
    expect(isEncryptedPayload(p)).toBe(true);
  });
  it('rejects non-payloads', () => {
    expect(isEncryptedPayload(null)).toBe(false);
    expect(isEncryptedPayload({ foo: 'bar' })).toBe(false);
    expect(isEncryptedPayload('string')).toBe(false);
  });
});

describe('secureWipe / secureWipeAll (#38)', () => {
  let store: Storage;
  beforeEach(() => { store = makeStorage(); });

  it('removes the key', () => {
    store.setItem('ollama_gui_secret', 'sensitive');
    secureWipe('ollama_gui_secret', store);
    expect(store.getItem('ollama_gui_secret')).toBeNull();
  });

  it('is a no-op for missing keys', () => {
    expect(() => secureWipe('absent', store)).not.toThrow();
  });

  it('wipes only prefixed keys', () => {
    store.setItem('ollama_gui_a', '1');
    store.setItem('mcp_b', '2');
    store.setItem('unrelated', '3');
    const wiped = secureWipeAll(['ollama_gui_', 'mcp_'], store);
    expect(wiped.sort()).toEqual(['mcp_b', 'ollama_gui_a']);
    expect(store.getItem('unrelated')).toBe('3');
  });
});
