import { describe, it, expect } from 'vitest';
import { checkMlxAvailable, isMlxModelName } from '../services/mlx';

// MLX is auto-detected; there are no enable/disable settings any more.
// Acceleration is considered active whenever the machine supports MLX and the
// selected local model is an MLX model (by name).

describe('checkMlxAvailable', () => {
  it('returns an unavailable result when Tauri is absent (no throw)', async () => {
    const result = await checkMlxAvailable();
    expect(result.available).toBe(false);
    expect(typeof result.reason).toBe('string');
  });
});

describe('isMlxModelName (#544)', () => {
  it('matches Ollama-style -mlx tags', () => {
    expect(isMlxModelName('qwen3.5:4b-mlx')).toBe(true);
    expect(isMlxModelName('gemma4:12b-mlx')).toBe(true);
    expect(isMlxModelName('llama3.2:3b-mlx-4bit')).toBe(true);
  });

  it('matches mlx-community style prefixes', () => {
    expect(isMlxModelName('mlx-community/Llama-3.2-3B-Instruct-4bit')).toBe(true);
    expect(isMlxModelName('MLX-thing')).toBe(true);
  });

  it('rejects names where mlx is only a substring of a word', () => {
    expect(isMlxModelName('mlxxl:7b')).toBe(false);
    expect(isMlxModelName('premlx:7b')).toBe(false);
    expect(isMlxModelName('llama3')).toBe(false);
  });
});
