/**
 * At-rest encryption for sensitive local data + secure cleanup (#38).
 *
 * Provides AES-GCM encryption via the Web Crypto API for opt-in encryption of
 * sensitive data such as chat history. A passphrase is stretched to a key with
 * PBKDF2; each payload carries its own random salt + IV. Also provides a
 * `secureWipe` that overwrites and removes a localStorage key so deleted data
 * cannot be trivially recovered from the same slot.
 *
 * Encryption is opt-in: the app keeps working with plaintext storage, and users
 * who want encryption-at-rest can enable it and supply a passphrase.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle) throw new Error('Web Crypto API is unavailable in this environment.');
  return c;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const crypto = getCrypto();
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface EncryptedPayload {
  v: 1;
  salt: string; // base64
  iv: string;   // base64
  data: string; // base64 ciphertext
}

/** Encrypt a UTF-8 string with a passphrase. Returns a serializable payload. */
export async function encryptString(plaintext: string, passphrase: string): Promise<EncryptedPayload> {
  const crypto = getCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { v: 1, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(ct)) };
}

/** Decrypt a payload produced by encryptString. Throws on wrong passphrase/tamper. */
export async function decryptString(payload: EncryptedPayload, passphrase: string): Promise<string> {
  const crypto = getCrypto();
  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const key = await deriveKey(passphrase, salt);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    fromBase64(payload.data),
  );
  return new TextDecoder().decode(pt);
}

/** True if a value looks like one of our encrypted payloads. */
export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  return !!value && typeof value === 'object'
    && (value as EncryptedPayload).v === 1
    && typeof (value as EncryptedPayload).data === 'string'
    && typeof (value as EncryptedPayload).iv === 'string'
    && typeof (value as EncryptedPayload).salt === 'string';
}

/**
 * Securely remove a localStorage key: overwrite the slot with random data of
 * similar length first, then delete it. Reduces the chance of the prior value
 * lingering in the same storage slot.
 */
export function secureWipe(key: string, store: Storage = localStorage): void {
  const existing = store.getItem(key);
  if (existing !== null) {
    let filler = '';
    const crypto = (globalThis as { crypto?: Crypto }).crypto;
    if (crypto?.getRandomValues) {
      const bytes = crypto.getRandomValues(new Uint8Array(Math.min(existing.length, 4096)));
      filler = toBase64(bytes);
    } else {
      filler = '0'.repeat(existing.length);
    }
    store.setItem(key, filler);
  }
  store.removeItem(key);
}

/**
 * Wipe all app data (chat history, sessions, config) from a store. Used by a
 * "clear all data securely" action. Only clears keys with the app prefix unless
 * `all` is true.
 */
export function secureWipeAll(prefixes: string[] = ['ollama_gui_', 'mcp_'], store: Storage = localStorage): string[] {
  const wiped: string[] = [];
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && prefixes.some(p => k.startsWith(p))) keys.push(k);
  }
  for (const k of keys) {
    secureWipe(k, store);
    wiped.push(k);
  }
  return wiped;
}
