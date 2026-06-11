/**
 * Speech-to-text dictation (#131) via local whisper.cpp HTTP server.
 *
 * The user runs whisper.cpp with --port 8080 (or whichever port they configure).
 * POST /inference with multipart/form-data, file field → JSON { text: "..." }.
 *
 * Recording uses the browser's MediaRecorder API; the injectable _setRecordFn
 * seam lets tests substitute a mock without requiring a real microphone.
 */
const STORAGE_KEY = 'stt_config';

export interface SttConfig {
  enabled: boolean;
  whisperUrl: string;        // e.g. 'http://127.0.0.1:8080'
  language: string;          // e.g. 'en', 'auto'
  maxDurationMs: number;     // hard cap on recording length
}

const DEFAULT_CONFIG: SttConfig = {
  enabled: false,
  whisperUrl: 'http://127.0.0.1:8080',
  language: 'auto',
  maxDurationMs: 60_000,
};

// ── Persistence ───────────────────────────────────────────────────────────────

export function loadSttConfig(): SttConfig {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }; } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveSttConfig(cfg: SttConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// ── Recording seam ────────────────────────────────────────────────────────────

export type RecordFn = (maxDurationMs: number) => Promise<Blob>;

let _recordImpl: RecordFn = defaultRecord;

export function _setRecordFn(fn: RecordFn): void { _recordImpl = fn; }

/** Default recording implementation using MediaRecorder. */
async function defaultRecord(maxDurationMs: number): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return new Promise((resolve, reject) => {
    // Prefer webm/opus which Whisper.cpp accepts via ffmpeg; fall back to whatever is supported
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
      MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    };
    recorder.onerror = () => { stream.getTracks().forEach(t => t.stop()); reject(new Error('Recording error')); };
    recorder.start();
    // Stop automatically at the max duration limit
    setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, maxDurationMs);
    // Expose stop handle on the recorder so startDictation can stop it early
    (recorder as any)._activeRecorder = recorder;
    _activeRecorder = recorder;
  });
}

let _activeRecorder: MediaRecorder | null = null;

/** Start recording. Returns a promise that resolves when stop() is called or maxDuration reached. */
export let currentRecordingPromise: Promise<Blob> | null = null;

export function startDictation(cfg?: SttConfig): Promise<Blob> {
  const config = cfg ?? loadSttConfig();
  if (!config.enabled) return Promise.reject(new Error('STT is disabled — enable it in Settings'));
  if (currentRecordingPromise) return currentRecordingPromise; // already recording
  currentRecordingPromise = _recordImpl(config.maxDurationMs).finally(() => {
    currentRecordingPromise = null;
  });
  return currentRecordingPromise;
}

/** Stop the active recording early. Does nothing if not recording. */
export function stopDictation(): void {
  if (_activeRecorder && _activeRecorder.state !== 'inactive') {
    _activeRecorder.stop();
    _activeRecorder = null;
  }
}

export function isRecording(): boolean {
  return currentRecordingPromise !== null;
}

// ── Transcription ─────────────────────────────────────────────────────────────

/** Send an audio blob to the whisper.cpp inference endpoint. */
export async function transcribeBlob(blob: Blob, cfg?: SttConfig): Promise<string> {
  const config = cfg ?? loadSttConfig();
  const base = config.whisperUrl.replace(/\/$/, '');

  const form = new FormData();
  form.append('file', blob, 'recording.webm');
  form.append('response_format', 'json');
  if (config.language !== 'auto') form.append('language', config.language);

  const res = await fetch(`${base}/inference`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Whisper inference error ${res.status}: ${res.statusText}`);

  const data = await res.json() as { text?: string; error?: string };
  if (data.error) throw new Error(`Whisper error: ${data.error}`);
  return (data.text ?? '').trim();
}

/** Record + transcribe in one call. */
export async function dictate(cfg?: SttConfig): Promise<string> {
  const config = cfg ?? loadSttConfig();
  const blob = await startDictation(config);
  return transcribeBlob(blob, config);
}

// ── Whisper server availability check ─────────────────────────────────────────

export async function checkWhisperAvailable(cfg?: SttConfig): Promise<boolean> {
  const config = cfg ?? loadSttConfig();
  try {
    const res = await fetch(`${config.whisperUrl.replace(/\/$/, '')}/`);
    return res.ok || res.status === 404; // 404 at root still means server is running
  } catch {
    return false;
  }
}
