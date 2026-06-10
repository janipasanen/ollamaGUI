import { describe, it, expect, vi } from 'vitest';
import { fetchOllamaModels, pullOllamaModel, deleteOllamaModel } from '../services/ollama';

describe('Ollama Service', () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  it('fetchOllamaModels should return a list of models with cloud property', async () => {
    const mockModels = [{ name: 'llama3' }, { name: 'mistral' }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: mockModels }),
    });

    const models = await fetchOllamaModels();
    expect(models).toEqual([
      { name: 'llama3', cloud: false },
      { name: 'mistral', cloud: false },
    ]);
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.any(Object));
  });

  it('pullOllamaModel should handle progress and completion', async () => {
    const mockBody = {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(JSON.stringify({ status: 'downloading' }) + '\n') })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }),
    };
    mockFetch.mockResolvedValue({
      ok: true,
      body: mockBody,
    });

    const progressUpdates: string[] = [];
    await pullOllamaModel('test-model', (progress) => {
      progressUpdates.push(progress.status);
    });

    expect(progressUpdates).toContain('downloading');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/pull', expect.any(Object));
  });

  it('deleteOllamaModel should call the DELETE endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
    });

    await deleteOllamaModel('test-model');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/delete', expect.objectContaining({
      method: 'DELETE'
    }));
  });
});
