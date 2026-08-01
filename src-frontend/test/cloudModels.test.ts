import { describe, it, expect, beforeEach } from 'vitest';
import {
  fetchCloudModels,
  loadCustomCloudModels,
  saveCustomCloudModels,
  isCloudModel,
  type ModelInfo,
} from '../services/ollama';
import { formatError } from '../services/errorMessages';

beforeEach(() => {
  localStorage.clear();
});

function local(name: string): ModelInfo {
  return { name, cloud: false };
}

describe('custom cloud model list (#485)', () => {
  it('starts empty rather than returning a hardcoded catalogue', async () => {
    expect(loadCustomCloudModels()).toEqual([]);
    expect(await fetchCloudModels([])).toEqual([]);
  });

  it('round-trips user-specified names', () => {
    saveCustomCloudModels(['gpt-oss:120b-cloud', 'my-model:cloud']);
    expect(loadCustomCloudModels()).toEqual(['gpt-oss:120b-cloud', 'my-model:cloud']);
  });

  it('trims, drops blanks, and de-duplicates on save', () => {
    saveCustomCloudModels(['  a:cloud  ', '', '   ', 'a:cloud', 'b:cloud']);
    expect(loadCustomCloudModels()).toEqual(['a:cloud', 'b:cloud']);
  });

  it('survives corrupt localStorage instead of throwing', () => {
    localStorage.setItem('ollama_gui_custom_cloud_models', '{not json');
    expect(loadCustomCloudModels()).toEqual([]);
    localStorage.setItem('ollama_gui_custom_cloud_models', '{"a":1}');
    expect(loadCustomCloudModels()).toEqual([]);
  });

  it('discovers cloud models the daemon already reports', async () => {
    const models = await fetchCloudModels([
      local('llama3:8b'),
      local('gpt-oss:120b-cloud'),
      local('something-cloud'),
    ]);
    expect(models.map(m => m.name)).toEqual(['gpt-oss:120b-cloud', 'something-cloud']);
    expect(models.every(m => m.cloud)).toBe(true);
  });

  it('merges discovered and user-specified names without duplicates', async () => {
    saveCustomCloudModels(['gpt-oss:120b-cloud', 'extra:cloud']);
    const models = await fetchCloudModels([local('gpt-oss:120b-cloud'), local('llama3:8b')]);
    expect(models.map(m => m.name)).toEqual(['gpt-oss:120b-cloud', 'extra:cloud']);
  });
});

describe('isCloudModel suffix detection', () => {
  it('matches both -cloud and :cloud, and nothing else', () => {
    expect(isCloudModel('gpt-oss:120b-cloud')).toBe(true);
    expect(isCloudModel('deepseek-v3.1:cloud')).toBe(true);
    expect(isCloudModel('llama3:8b')).toBe(false);
  });
});

describe('cloud vs local connection errors (#484)', () => {
  it('does not blame the local daemon when a cloud request fails', () => {
    const { title, detail } = formatError(new Error('Load failed'), 'ollama-cloud');
    expect(title).toBe('Cannot reach Ollama Cloud');
    // The old behaviour told users to run `ollama serve` even though it was running.
    expect(detail).not.toContain('ollama serve');
    expect(detail).toContain('ollama signin');
  });

  it('still tells users to start Ollama for genuine local failures', () => {
    const { title, detail } = formatError(new Error('Failed to fetch'), 'ollama');
    expect(title).toBe('Cannot reach Ollama');
    expect(detail).toContain('ollama serve');
  });
});
