import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ollamaStream, mlxStream } = vi.hoisted(() => ({
  ollamaStream: vi.fn(),
  mlxStream: vi.fn(),
}));

vi.mock('../services/ollama', () => ({ fetchOllamaChatStream: ollamaStream }));
vi.mock('../services/mlx', () => ({ fetchMlxChatStream: mlxStream }));

import { runCloudBrainLocalWorker } from '../services/orchestrator';

const baseOpts = {
  brainModel: 'cloud-brain',
  workerModel: 'local-worker',
  messages: [{ role: 'user', content: 'build a thing' }],
  ollamaEndpoint: 'http://localhost:11434/api/chat',
  cloudEndpoint: 'https://cloud.ollama.ai/api/chat',
  onPhase: vi.fn(),
  onDelta: vi.fn(),
};

describe('runCloudBrainLocalWorker — phase flow (#226)', () => {
  beforeEach(() => { ollamaStream.mockReset(); mlxStream.mockReset(); });

  it('runs brain-plan → worker → brain-final and returns the final answer', async () => {
    let ollamaCalls = 0;
    ollamaStream.mockImplementation(async (_model: string, _msgs: any, onChunk: any) => {
      ollamaCalls += 1;
      if (ollamaCalls === 1) onChunk({ message: { content: 'PLAN: step\nINSTRUCTION: do the thing' } });
      else onChunk({ message: { content: 'final polished answer' } });
    });
    mlxStream.mockImplementation(async (_m: string, _msgs: any, onChunk: any) => {
      onChunk('worker output');
    });

    const result = await runCloudBrainLocalWorker({
      ...baseOpts,
      mlx: { active: false, port: 0 },
    } as any);

    expect(result).toBe('final polished answer');
    const phases = (baseOpts.onPhase as any).mock.calls.map((c: any) => c[0]);
    expect(phases).toEqual(['brain-plan', 'worker', 'brain-final']);
    expect(ollamaStream).toHaveBeenCalledTimes(3); // brain-plan + worker (Ollama) + brain-final
    expect(mlxStream).not.toHaveBeenCalled();
  });
});

describe('runCloudBrainLocalWorker — reasoning capture (#252)', () => {
  beforeEach(() => { ollamaStream.mockReset(); mlxStream.mockReset(); });

  it('forwards Ollama thinking from the brain phases via onReasoning', async () => {
    const onReasoning = vi.fn();
    let ollamaCalls = 0;
    ollamaStream.mockImplementation(async (_model: string, _msgs: any, onChunk: any) => {
      ollamaCalls += 1;
      if (ollamaCalls === 1) {
        onChunk({ message: { content: 'INSTRUCTION: do it', thinking: 'planning reasoning' } });
      } else {
        onChunk({ message: { content: 'final answer' }, thinking: 'synthesis reasoning' });
      }
    });
    mlxStream.mockImplementation(async (_m: string, _msgs: any, onChunk: any) => { onChunk('out'); });

    await runCloudBrainLocalWorker({
      ...baseOpts,
      onReasoning,
      mlx: { active: false, port: 0 },
    } as any);

    const reasoningByPhase = new Map<string, string>();
    for (const [phase, full] of onReasoning.mock.calls as any[]) {
      reasoningByPhase.set(phase, full);
    }
    expect(reasoningByPhase.get('brain-plan')).toBe('planning reasoning');
    expect(reasoningByPhase.get('brain-final')).toBe('synthesis reasoning');
  });

  it('forwards top-level thinking (no message wrapper) as reasoning', async () => {
    const onReasoning = vi.fn();
    ollamaStream.mockImplementation(async (_m: string, _msgs: any, onChunk: any) => {
      onChunk({ thinking: 'top-level thinking', message: { content: 'INSTRUCTION: x' } });
    });
    mlxStream.mockImplementation(async (_m: string, _msgs: any, onChunk: any) => { onChunk('out'); });

    await runCloudBrainLocalWorker({
      ...baseOpts,
      onReasoning,
      mlx: { active: false, port: 0 },
    } as any);

    expect(onReasoning).toHaveBeenCalled();
    expect((onReasoning.mock.calls[0] as any[])[1]).toBe('top-level thinking');
  });

  it('forwards MLX worker reasoning via the (delta, reasoning) callback', async () => {
    const onReasoning = vi.fn();
    ollamaStream.mockImplementation(async (_m: string, _msgs: any, onChunk: any) => {
      onChunk({ message: { content: 'INSTRUCTION: do it' } });
      // brain-final
    });
    let ollamaCalls = 0;
    ollamaStream.mockImplementation(async (_m: string, _msgs: any, onChunk: any) => {
      ollamaCalls += 1;
      if (ollamaCalls === 1) onChunk({ message: { content: 'INSTRUCTION: do it' } });
      else onChunk({ message: { content: 'final answer' } });
    });
    mlxStream.mockImplementation(async (_m: string, _msgs: any, onChunk: any) => {
      onChunk('worker out', 'worker reasoning');
    });

    await runCloudBrainLocalWorker({
      ...baseOpts,
      onReasoning,
      mlx: { active: true, port: 8080 },
    } as any);

    const workerReasoning = (onReasoning.mock.calls.find((c: any) => c[0] === 'worker') as any[])?.[1];
    expect(workerReasoning).toBe('worker reasoning');
    expect(mlxStream).toHaveBeenCalledTimes(1);
  });

  it('does not call onReasoning when the stream emits no thinking', async () => {
    const onReasoning = vi.fn();
    let ollamaCalls = 0;
    ollamaStream.mockImplementation(async (_m: string, _msgs: any, onChunk: any) => {
      ollamaCalls += 1;
      if (ollamaCalls === 1) onChunk({ message: { content: 'INSTRUCTION: do it' } });
      else onChunk({ message: { content: 'final answer' } });
    });
    mlxStream.mockImplementation(async (_m: string, _msgs: any, onChunk: any) => { onChunk('out'); });

    await runCloudBrainLocalWorker({
      ...baseOpts,
      onReasoning,
      mlx: { active: false, port: 0 },
    } as any);

    expect(onReasoning).not.toHaveBeenCalled();
  });
});
