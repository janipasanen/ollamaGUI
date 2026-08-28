import { describe, it, expect, beforeEach } from 'vitest';
import {
  getActiveConnectionId,
  resolveConnection,
  pickConnectionIdForModel,
  DEFAULT_CONNECTION_ID,
} from '../services/sessionRouting';
import type { ModelConnection } from '../services/connections';

const conn = (id: string, enabled = true): ModelConnection => ({
  id,
  name: id.toUpperCase(),
  kind: id === 'local-ollama' ? 'ollama' : 'openai',
  baseUrl: `http://${id}`,
  enabled,
});

// ── getActiveConnectionId ─────────────────────────────────────────────────────

describe('getActiveConnectionId (G3)', () => {
  it('returns the session connectionId when explicitly set', () => {
    const connections = [conn('local-ollama'), conn('lm-studio')];
    const id = getActiveConnectionId({ connectionId: 'lm-studio' }, connections);
    expect(id).toBe('lm-studio');
  });

  it('falls back to local-ollama when no session connectionId', () => {
    const connections = [conn('other-ollama'), conn('local-ollama')];
    const id = getActiveConnectionId(undefined, connections);
    expect(id).toBe('local-ollama');
  });

  it('falls back to the first enabled connection when local-ollama absent', () => {
    const connections = [conn('first-ollama', true), conn('disabled', false)];
    const id = getActiveConnectionId(null, connections);
    expect(id).toBe('first-ollama');
  });

  it('prefers local-ollama over an earlier-but-disabled connection', () => {
    const connections = [conn('disabled', false), conn('local-ollama'), conn('lm-studio')];
    const id = getActiveConnectionId({ connectionId: undefined as unknown as string }, connections);
    expect(id).toBe('local-ollama');
  });

  it('returns the default id for an empty connection list', () => {
    expect(getActiveConnectionId(undefined, [])).toBe(DEFAULT_CONNECTION_ID);
  });
});

// ── resolveConnection ─────────────────────────────────────────────────────────

describe('resolveConnection (G3)', () => {
  it('returns the ModelConnection matching the active id', () => {
    const connections = [conn('local-ollama'), conn('lm-studio')];
    const resolved = resolveConnection({ connectionId: 'lm-studio' }, connections);
    expect(resolved?.id).toBe('lm-studio');
    expect(resolved?.kind).toBe('openai');
  });

  it('returns null when the active connection is disabled', () => {
    const connections = [conn('disabled', false)];
    expect(resolveConnection({ connectionId: 'disabled' }, connections)).toBeNull();
  });

  it('returns null when no enabled connection matches', () => {
    expect(resolveConnection({ connectionId: 'missing' }, [conn('local-ollama')])).toBeNull();
  });
});

// ── pickConnectionIdForModel ──────────────────────────────────────────────────

describe('pickConnectionIdForModel (G3)', () => {
  it('maps a model id to its owning connection', () => {
    const connections = [conn('local-ollama'), conn('lm-studio')];
    const connectedModels = [{ id: 'lm-studio/my-model', connectionId: 'lm-studio' }];
    const id = pickConnectionIdForModel(null, 'lm-studio/my-model', connections, connectedModels);
    expect(id).toBe('lm-studio');
  });

  it('returns the default connection id when the model id is unknown', () => {
    const connections = [conn('local-ollama'), conn('lm-studio')];
    const id = pickConnectionIdForModel(null, 'unknown-model', connections, []);
    expect(id).toBe('local-ollama');
  });

  it('keeps the session connection id when the model belongs to it', () => {
    const connections = [conn('local-ollama'), conn('lm-studio')];
    const connectedModels = [{ id: 'lm-studio/my-model', connectionId: 'lm-studio' }];
    const id = pickConnectionIdForModel({ connectionId: 'lm-studio' }, 'lm-studio/my-model', connections, connectedModels);
    expect(id).toBe('lm-studio');
  });

  it('handles a missing model id and empty connectedModels gracefully', () => {
    const connections = [conn('local-ollama')];
    expect(pickConnectionIdForModel(null, undefined, connections, [])).toBe('local-ollama');
  });
});
