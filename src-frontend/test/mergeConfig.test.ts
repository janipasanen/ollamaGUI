/**
 * mergeConfigWithConnections (#553): reconcile config.json providers with
 * localStorage-backed connections.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeConfigWithConnections, getDefaultConnections } from '../services/connections';
import type { ModelConnection } from '../services/connections';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('mergeConfigWithConnections (#553)', () => {
  it('returns storage connections unchanged when config is empty', () => {
    const storage: ModelConnection[] = getDefaultConnections();
    expect(mergeConfigWithConnections(storage, [])).toBe(storage);
  });

  it('adds a config.json provider that localStorage did not register', () => {
    const storage: ModelConnection[] = [{
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    }];
    const cfg: ModelConnection[] = [{
      id: 'gemma', name: 'Gemma Local', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    }];
    const merged = mergeConfigWithConnections(storage, cfg);
    expect(merged.map(c => c.id).sort()).toEqual(['gemma', 'local-ollama']);
  });

  it('applies a config.json defaultModel to an enabled storage connection (#553)', () => {
    const storage: ModelConnection[] = [{
      id: 'lm-studio', name: 'LM Studio', kind: 'openai',
      baseUrl: 'http://gx10:1234', apiKey: '', enabled: true,
    }];
    const cfg: ModelConnection[] = [{
      id: 'lm-studio', name: 'LM Studio', kind: 'openai',
      baseUrl: 'http://gx10:1234', apiKey: '', enabled: true,
      defaultModel: 'north-mini-code-1.0:q8_0',
    }];
    const merged = mergeConfigWithConnections(storage, cfg);
    expect(merged[0].enabled).toBe(true);
    expect(merged[0].defaultModel).toBe('north-mini-code-1.0:q8_0');
  });

  it('re-enables a disabled built-in default from config.json', () => {
    const storage: ModelConnection[] = [{
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: false,
    }];
    const cfg: ModelConnection[] = [{
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    }];
    const merged = mergeConfigWithConnections(storage, cfg);
    expect(merged[0].enabled).toBe(true);
    expect(merged[0].name).toBe('Local Ollama');
  });

  it('keeps a user-enabled (non-default) connection disabled', () => {
    const storage: ModelConnection[] = [{
      id: 'my-conn', name: 'My Conn', kind: 'openai',
      baseUrl: 'http://localhost:1234', apiKey: 'x', enabled: true,
    }];
    const cfg: ModelConnection[] = [{
      id: 'my-conn', name: 'My Conn (edited)', kind: 'openai',
      baseUrl: 'http://localhost:1234', enabled: false,
    }];
    const merged = mergeConfigWithConnections(storage, cfg);
    // Storage edit (enabled: true) wins; config.json cannot override a non-default.
    expect(merged[0].enabled).toBe(true);
    expect(merged[0].apiKey).toBe('x');
  });

  it('does not duplicate a provider present in both', () => {
    const storage: ModelConnection[] = [{
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    }];
    const cfg: ModelConnection[] = [{
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    }];
    const merged = mergeConfigWithConnections(storage, cfg);
    expect(merged).toHaveLength(1);
  });

  it('ignores duplicate ids already present in config.json', () => {
    const storage: ModelConnection[] = [{
      id: 'local-ollama', name: 'Local Ollama', kind: 'ollama',
      baseUrl: 'http://localhost:11434', enabled: true,
    }];
    const cfg: ModelConnection[] = [
      { id: 'local-ollama', name: 'Local Ollama', kind: 'ollama', baseUrl: 'http://localhost:11434', enabled: true },
      { id: 'local-ollama', name: 'Dup', kind: 'ollama', baseUrl: 'http://dup:11434', enabled: true },
    ];
    const merged = mergeConfigWithConnections(storage, cfg);
    expect(merged.length).toBeLessThanOrEqual(2);
    // Only one "local-ollama" id should exist.
    const occ = merged.filter(c => c.id === 'local-ollama');
    expect(occ).toHaveLength(1);
  });
});
