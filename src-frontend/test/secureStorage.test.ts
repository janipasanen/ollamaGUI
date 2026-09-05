import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptString,
  decryptString,
  isEncryptedPayload,
  secureWipe,
  secureWipeAll, APP_STORAGE_KEYS,
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

// ── Secure erase must actually erase (#596, #597) ────────────────────────────

describe('secureWipeAll covers non-prefixed app keys (#597)', () => {
  it('wipes the stores holding plaintext API keys', () => {
    // These match neither 'ollama_gui_' nor 'mcp_', so the prefix pass alone
    // left live LM Studio / vLLM / OpenAI / OpenAPI / image-gen credentials on
    // a machine the user had just been told was erased.
    localStorage.setItem('model_connections', JSON.stringify([{ id: 'x', apiKey: 'sk-secret' }]));
    localStorage.setItem('openapi_servers', JSON.stringify([{ apiKey: 'sk-other' }]));
    localStorage.setItem('imagegen_config', JSON.stringify({ apiKey: 'sk-img' }));
    localStorage.setItem('ollama_gui_sessions', '[]');

    const wiped = secureWipeAll();

    expect(localStorage.getItem('model_connections')).toBeNull();
    expect(localStorage.getItem('openapi_servers')).toBeNull();
    expect(localStorage.getItem('imagegen_config')).toBeNull();
    expect(localStorage.getItem('ollama_gui_sessions')).toBeNull();
    expect(wiped).toContain('model_connections');
  });

  it('wipes the remaining enumerated keys', () => {
    for (const k of APP_STORAGE_KEYS) localStorage.setItem(k, 'x');
    secureWipeAll();
    for (const k of APP_STORAGE_KEYS) {
      expect(localStorage.getItem(k), `${k} should be wiped`).toBeNull();
    }
  });

  it('leaves keys the app does not own alone', () => {
    localStorage.setItem('some_other_app_key', 'keep me');
    secureWipeAll();
    expect(localStorage.getItem('some_other_app_key')).toBe('keep me');
  });

  it('does not report a key that was not present', () => {
    localStorage.setItem('model_connections', 'x');
    const wiped = secureWipeAll();
    expect(wiped).toContain('model_connections');
    expect(wiped).not.toContain('imagegen_config');
  });
});

describe('APP_STORAGE_KEYS stays in sync with the source (#597)', () => {
  it('every localStorage key constant in services/ is wiped by prefix or by list', async () => {
    // The guard that stops the list rotting: a new STORAGE_KEY constant that
    // matches neither a prefix nor the list fails here rather than silently
    // surviving a "secure erase" years later.
    //
    // It scans CONSTANT DECLARATIONS, not `localStorage.getItem('literal')`:
    // every store in this codebase goes through a `const …KEY = '…'`, so a
    // literal scan finds zero keys and passes vacuously. (It did, first try.)
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(__dirname, '..', 'services');
    const PREFIXES = ['ollama_gui_', 'mcp_'];
    // Mirror-file names, not localStorage keys: cleared by clearDisk (#596).
    const DISK_KEYS = ['sessions', 'folders', 'projects'];

    const decl = /const\s+[A-Za-z0-9_]*(?:KEY|STORAGE)[A-Za-z0-9_]*\s*(?::\s*string\s*)?=\s*'([A-Za-z0-9_.-]+)'/g;
    const seen = new Set<string>();
    const missing: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue;
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(decl)) {
        const key = m[1];
        seen.add(key);
        if (PREFIXES.some(p => key.startsWith(p))) continue;
        if (DISK_KEYS.includes(key)) continue;
        if (APP_STORAGE_KEYS.includes(key)) continue;
        missing.push(`${f}: ${key}`);
      }
    }
    // Fail loudly if the scan itself stops matching — a guard that finds
    // nothing is worse than no guard, because it reads as a passing check.
    expect(seen.size).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});
