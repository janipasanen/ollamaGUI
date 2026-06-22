/**
 * Frontend wrapper for the Rust secret_set/get/delete keychain commands (#173).
 *
 * Values are stored in the OS keychain (macOS Keychain, Windows Credential
 * Manager, Linux libsecret) with an AES-GCM encrypted file as a fallback on
 * systems that lack an OS keychain.
 *
 * The frontend never persists secret values; only (service, key) identifiers
 * are tracked in localStorage so the Settings UI can list what exists.
 */

import { invoke } from '@tauri-apps/api/core';

const KEYS_STORE = 'ollama_gui_secret_keys';

export interface SecretRef {
  service: string;
  key: string;
}

function loadRefs(): SecretRef[] {
  try {
    return JSON.parse(localStorage.getItem(KEYS_STORE) ?? '[]');
  } catch {
    return [];
  }
}

function saveRefs(refs: SecretRef[]): void {
  localStorage.setItem(KEYS_STORE, JSON.stringify(refs));
}

/** Store a secret value in the OS keychain. Tracks the (service, key) pair. */
export async function secretSet(service: string, key: string, value: string): Promise<void> {
  await invoke('secret_set', { service, key, value });
  const refs = loadRefs().filter(r => !(r.service === service && r.key === key));
  refs.unshift({ service, key });
  saveRefs(refs);
}

/** Retrieve a secret value. Returns null if not found. */
export async function secretGet(service: string, key: string): Promise<string | null> {
  const result = await invoke<string | null>('secret_get', { service, key });
  return result ?? null;
}

/** Delete a secret and remove its tracker entry. */
export async function secretDelete(service: string, key: string): Promise<void> {
  await invoke('secret_delete', { service, key });
  saveRefs(loadRefs().filter(r => !(r.service === service && r.key === key)));
}

/** List tracked (service, key) pairs. Values are never stored here. */
export function secretListRefs(): SecretRef[] {
  return loadRefs();
}
