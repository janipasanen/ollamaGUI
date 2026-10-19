/**
 * Test helper: give the app a provider to talk to (#566).
 *
 * Nothing is pre-configured any more — a fresh install contacts no server and
 * opens empty. Every spec that expects local Ollama models to appear must
 * therefore say so explicitly, the same way a user would by adding the
 * provider in Settings. Call this in `beforeEach`, AFTER `localStorage.clear()`.
 */

const STORAGE_KEY = 'model_connections';

export const LOCAL_OLLAMA_ID = 'test-local-ollama';

/**
 * Seed a local Ollama provider so `/api/tags` is fetched.
 *
 * The id is fixed rather than random so a spec can assert against it, and the
 * URL matches the app's default base URL, which is what the fetch mocks in
 * these specs already answer for.
 */
export function seedLocalOllama(baseUrl = 'http://localhost:11434'): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([
    { id: LOCAL_OLLAMA_ID, name: 'Local Ollama', kind: 'ollama', baseUrl, enabled: true },
  ]));
}
