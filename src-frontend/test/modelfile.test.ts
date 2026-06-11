import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assembleModelfile, createOllamaModel } from '../services/ollama';

describe('Modelfile assembly (#125)', () => {
  it('FROM only', () => {
    expect(assembleModelfile({ from: 'llama3.2:1b' })).toBe('FROM llama3.2:1b');
  });

  it('includes SYSTEM block when set', () => {
    const mf = assembleModelfile({ from: 'ministral-3:3b', system: 'You are a helpful assistant.' });
    expect(mf).toContain('FROM ministral-3:3b');
    expect(mf).toContain('SYSTEM """You are a helpful assistant."""');
  });

  it('includes PARAMETER temperature', () => {
    const mf = assembleModelfile({ from: 'llama3.2:1b', temperature: 0.7 });
    expect(mf).toContain('PARAMETER temperature 0.7');
  });

  it('includes PARAMETER num_ctx', () => {
    const mf = assembleModelfile({ from: 'llama3.2:1b', numCtx: 4096 });
    expect(mf).toContain('PARAMETER num_ctx 4096');
  });

  it('includes PARAMETER stop', () => {
    const mf = assembleModelfile({ from: 'llama3.2:1b', stop: '</s>' });
    expect(mf).toContain('PARAMETER stop "</s>"');
  });

  it('includes TEMPLATE block', () => {
    const mf = assembleModelfile({ from: 'llama3.2:1b', template: '{{ .Prompt }}' });
    expect(mf).toContain('TEMPLATE """{{ .Prompt }}"""');
  });

  it('omits empty optional fields', () => {
    const mf = assembleModelfile({ from: 'gemma2:2b' });
    expect(mf).not.toContain('SYSTEM');
    expect(mf).not.toContain('PARAMETER');
    expect(mf).not.toContain('TEMPLATE');
  });

  it('assembles all fields together', () => {
    const mf = assembleModelfile({
      from: 'ministral-3:3b',
      system: 'You are a code reviewer.',
      temperature: 0.2,
      numCtx: 8192,
    });
    expect(mf).toContain('FROM ministral-3:3b');
    expect(mf).toContain('SYSTEM """You are a code reviewer."""');
    expect(mf).toContain('PARAMETER temperature 0.2');
    expect(mf).toContain('PARAMETER num_ctx 8192');
  });
});

describe('createOllamaModel — progress stream (#125)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockStream(lines: string[]) {
    const encoder = new TextEncoder();
    let i = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (i < lines.length) {
          controller.enqueue(encoder.encode(lines[i++] + '\n'));
        } else {
          controller.close();
        }
      },
    });
    return Promise.resolve({ ok: true, statusText: 'OK', body } as any);
  }

  it('streams progress events to onProgress callback', async () => {
    const events: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(mockStream([
      '{"status":"creating system layer"}',
      '{"status":"writing manifest"}',
      '{"status":"success"}',
    ]));
    await createOllamaModel('my-model', 'FROM llama3.2:1b', e => events.push(e));
    expect(events).toHaveLength(3);
    expect(events[0].status).toBe('creating system layer');
    expect(events[2].status).toBe('success');
  });

  it('throws on non-ok HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, statusText: 'Bad Request' } as any);
    await expect(createOllamaModel('bad', 'FROM x', () => {})).rejects.toThrow('Ollama create error');
  });

  it('sends correct request body (name + modelfile)', async () => {
    let capturedBody: any;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, opts) => {
      capturedBody = JSON.parse(opts!.body as string);
      return mockStream(['{"status":"success"}']);
    });
    await createOllamaModel('test-model', 'FROM llama3.2:1b\nPARAMETER temperature 0.5', () => {});
    expect(capturedBody.name).toBe('test-model');
    expect(capturedBody.modelfile).toContain('temperature 0.5');
  });
});
