import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadSttConfig, saveSttConfig,
  transcribeBlob, checkWhisperAvailable, startDictation,
  _setRecordFn,
  type SttConfig,
} from '../services/stt';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ── Persistence ───────────────────────────────────────────────────────────────

describe('loadSttConfig / saveSttConfig (#131)', () => {
  it('returns defaults when nothing is stored', () => {
    const cfg = loadSttConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.whisperUrl).toBe('http://127.0.0.1:8080');
    expect(cfg.language).toBe('auto');
    expect(cfg.maxDurationMs).toBe(60_000);
  });

  it('round-trips config through localStorage', () => {
    const cfg: SttConfig = { enabled: true, whisperUrl: 'http://localhost:9090', language: 'en', maxDurationMs: 30_000 };
    saveSttConfig(cfg);
    expect(loadSttConfig()).toEqual(cfg);
  });

  it('merges stored values with defaults', () => {
    localStorage.setItem('stt_config', JSON.stringify({ enabled: true, language: 'fi' }));
    const cfg = loadSttConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.language).toBe('fi');
    expect(cfg.whisperUrl).toBe('http://127.0.0.1:8080'); // default still present
  });
});

// ── transcribeBlob ─────────────────────────────────────────────────────────────

describe('transcribeBlob (#131)', () => {
  const cfg: SttConfig = { enabled: true, whisperUrl: 'http://127.0.0.1:8080', language: 'auto', maxDurationMs: 60_000 };
  const blob = new Blob(['fake audio'], { type: 'audio/webm' });

  it('posts to /inference and returns trimmed text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: '  Hello world.  ' }),
    } as any);
    const text = await transcribeBlob(blob, cfg);
    expect(text).toBe('Hello world.');
  });

  it('sends multipart form-data with file and response_format', async () => {
    let calledWith: { url: string; opts: any } | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, opts) => {
      calledWith = { url: url as string, opts };
      return { ok: true, json: async () => ({ text: 'hi' }) } as any;
    });
    await transcribeBlob(blob, cfg);
    expect(calledWith!.url).toBe('http://127.0.0.1:8080/inference');
    expect(calledWith!.opts.method).toBe('POST');
    expect(calledWith!.opts.body).toBeInstanceOf(FormData);
    const fd = calledWith!.opts.body as FormData;
    expect(fd.get('response_format')).toBe('json');
  });

  it('strips trailing slash from whisperUrl', async () => {
    let url = '';
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (u) => {
      url = u as string;
      return { ok: true, json: async () => ({ text: '' }) } as any;
    });
    await transcribeBlob(blob, { ...cfg, whisperUrl: 'http://127.0.0.1:8080/' });
    expect(url).toBe('http://127.0.0.1:8080/inference');
  });

  it('does not include language param when language is auto', async () => {
    let fd: FormData | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_u, opts) => {
      fd = opts!.body as FormData;
      return { ok: true, json: async () => ({ text: '' }) } as any;
    });
    await transcribeBlob(blob, { ...cfg, language: 'auto' });
    expect(fd!.get('language')).toBeNull();
  });

  it('includes language param when language is set', async () => {
    let fd: FormData | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_u, opts) => {
      fd = opts!.body as FormData;
      return { ok: true, json: async () => ({ text: '' }) } as any;
    });
    await transcribeBlob(blob, { ...cfg, language: 'fi' });
    expect(fd!.get('language')).toBe('fi');
  });

  it('throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' } as any);
    await expect(transcribeBlob(blob, cfg)).rejects.toThrow('Whisper inference error 500');
  });

  it('throws when response contains error field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'unsupported format' }),
    } as any);
    await expect(transcribeBlob(blob, cfg)).rejects.toThrow('Whisper error: unsupported format');
  });
});

// ── startDictation — injectable seam ─────────────────────────────────────────

describe('startDictation (#131)', () => {
  it('rejects when STT is disabled', async () => {
    const cfg: SttConfig = { enabled: false, whisperUrl: 'http://x', language: 'auto', maxDurationMs: 1000 };
    await expect(startDictation(cfg)).rejects.toThrow('disabled');
  });

  it('uses the injected record function', async () => {
    const mockBlob = new Blob(['audio'], { type: 'audio/webm' });
    _setRecordFn(async (_dur) => mockBlob);
    const cfg: SttConfig = { enabled: true, whisperUrl: 'http://x', language: 'auto', maxDurationMs: 1000 };
    const result = await startDictation(cfg);
    expect(result).toBe(mockBlob);
  });
});

// ── checkWhisperAvailable ─────────────────────────────────────────────────────

describe('checkWhisperAvailable (#131)', () => {
  const cfg: SttConfig = { enabled: true, whisperUrl: 'http://127.0.0.1:8080', language: 'auto', maxDurationMs: 60_000 };

  it('returns true when server responds with ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true } as any);
    expect(await checkWhisperAvailable(cfg)).toBe(true);
  });

  it('returns true on 404 (server running but no root route)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 404 } as any);
    expect(await checkWhisperAvailable(cfg)).toBe(true);
  });

  it('returns false when fetch throws (server not running)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('connection refused'));
    expect(await checkWhisperAvailable(cfg)).toBe(false);
  });
});
