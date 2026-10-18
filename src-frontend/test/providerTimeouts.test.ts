/**
 * #663 — provider HTTP calls must carry a timeout.
 *
 * AGENTS.md requires timeout handling for provider interactions; the Ollama
 * client has it, every other provider path did not. These tests pin the signal
 * onto each fetch and check that an aborted call surfaces as an error instead of
 * hanging the caller.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PROVIDER_TIMEOUTS, timeoutSignal } from '../services/net';
import { generateA1111, type ImageGenConfig } from '../services/imagegen';
import { embed } from '../services/rag';
import { makeSummarizeFn, makeOpenAiSummarizeFn } from '../services/compaction';
import { fetchOpenApiSpec } from '../services/openapiTools';
import { transcribeBlob, type SttConfig } from '../services/stt';

const isSignal = (s: unknown): boolean =>
  typeof AbortSignal !== 'undefined' && s instanceof AbortSignal;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('timeoutSignal (#663)', () => {
  it('returns an AbortSignal', () => {
    const signal = timeoutSignal(1000);
    expect(isSignal(signal)).toBe(true);
    expect(signal.aborted).toBe(false);
  });

  it('falls back to AbortController when AbortSignal.timeout is missing', () => {
    const original = (AbortSignal as any).timeout;
    // jsdom does not always ship the static helper; exercise the fallback.
    (AbortSignal as any).timeout = undefined;
    vi.useFakeTimers();
    try {
      const signal = timeoutSignal(500);
      expect(signal.aborted).toBe(false);
      vi.advanceTimersByTime(499);
      expect(signal.aborted).toBe(false);
      vi.advanceTimersByTime(1);
      expect(signal.aborted).toBe(true);
      expect((signal.reason as DOMException).name).toBe('TimeoutError');
    } finally {
      vi.useRealTimers();
      (AbortSignal as any).timeout = original;
    }
  });

  it('exposes a per-operation budget', () => {
    // Ordered from fastest to slowest; a swap is a design change, not a typo.
    expect(PROVIDER_TIMEOUTS.sttProbe).toBeLessThan(PROVIDER_TIMEOUTS.embeddings);
    expect(PROVIDER_TIMEOUTS.embeddings).toBeLessThanOrEqual(PROVIDER_TIMEOUTS.imageGeneration);
    expect(PROVIDER_TIMEOUTS.compaction).toBeLessThanOrEqual(PROVIDER_TIMEOUTS.imageGeneration);
  });
});

describe('provider fetches pass a timeout signal (#663)', () => {
  it('image generation (A1111)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ images: ['abc'] }),
    } as any);
    const cfg: ImageGenConfig = { backend: 'a1111', baseUrl: 'http://127.0.0.1:7860', enabled: true };
    await generateA1111(cfg, { prompt: 'a cat' });
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(isSignal(opts.signal)).toBe(true);
  });

  it('RAG embeddings', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2]] }),
    } as any);
    await embed(['hello'], { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434' });
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(isSignal(opts.signal)).toBe(true);
  });

  it('conversation compaction (Ollama)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: 'summary' } }),
    } as any);
    await makeSummarizeFn('llama3', 'http://127.0.0.1:11434/api/chat')([
      { role: 'user', content: 'hi' },
    ]);
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(isSignal(opts.signal)).toBe(true);
  });

  it('conversation compaction (OpenAI-compatible)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'summary' } }] }),
    } as any);
    await makeOpenAiSummarizeFn(
      { id: 'c1', name: 'local', baseUrl: 'http://127.0.0.1:1234', kind: 'openai' } as any,
      'model'
    )([{ role: 'user', content: 'hi' }]);
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(isSignal(opts.signal)).toBe(true);
  });

  it('OpenAPI spec fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ openapi: '3.0.0', paths: {} }),
    } as any);
    await fetchOpenApiSpec('http://127.0.0.1:9/openapi.json');
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(isSignal(opts.signal)).toBe(true);
  });

  it('STT transcription', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'hello' }),
    } as any);
    const cfg: SttConfig = {
      enabled: true,
      whisperUrl: 'http://127.0.0.1:8080',
      language: 'auto',
      maxDurationMs: 60_000,
    };
    await transcribeBlob(new Blob(['x'], { type: 'audio/webm' }), cfg);
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(isSignal(opts.signal)).toBe(true);
  });
});

describe('an aborted provider call surfaces as an error (#663)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('image generation rejects instead of hanging', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    );
    const cfg: ImageGenConfig = { backend: 'a1111', baseUrl: 'http://127.0.0.1:7860', enabled: true };
    await expect(generateA1111(cfg, { prompt: 'a cat' })).rejects.toThrow(/abort|timeout/i);
  });

  it('STT rejects instead of hanging', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    );
    const cfg: SttConfig = {
      enabled: true,
      whisperUrl: 'http://127.0.0.1:8080',
      language: 'auto',
      maxDurationMs: 60_000,
    };
    await expect(
      transcribeBlob(new Blob(['x'], { type: 'audio/webm' }), cfg)
    ).rejects.toThrow(/abort|timeout|transcri/i);
  });
});
