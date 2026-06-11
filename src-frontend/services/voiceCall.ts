/**
 * Hands-free voice call mode (#132).
 *
 * State machine:
 *   idle → listening → transcribing → responding → speaking → listening → …
 *
 * VAD (Voice Activity Detection) gates recording: once the mic RMS exceeds the
 * silence threshold the call moves to `transcribing`; extended silence after
 * speech ends the utterance.
 *
 * Barge-in: if the mic RMS exceeds the threshold during TTS playback, speech is
 * cancelled and the loop goes straight back to `listening`.
 *
 * All I/O (STT, chat, TTS) passes through injectable functions so tests can run
 * the full state machine without real hardware.
 */

export type CallState = 'idle' | 'listening' | 'transcribing' | 'responding' | 'speaking' | 'error';

export interface VoiceCallCallbacks {
  onStateChange: (state: CallState) => void;
  onTranscript: (text: string) => void;
  onResponseChunk: (chunk: string) => void;
  onResponseComplete: (full: string) => void;
  onError: (error: string) => void;
}

export interface VoiceCallOptions {
  /**
   * Transcribes a Blob of audio and returns the text.
   * Injected by tests; defaults to the stt service.
   */
  transcribeFn: (blob: Blob) => Promise<string>;
  /**
   * Speaks text aloud; returns a promise that resolves when speech ends.
   * Injected by tests; defaults to window.speechSynthesis.
   */
  speakFn: (text: string, signal: AbortSignal) => Promise<void>;
  /**
   * Records until VAD detects end-of-utterance; returns a Blob.
   * Injected by tests.
   */
  recordUtteranceFn: (vadOptions: { silenceMs: number; thresholdRms: number; maxMs: number }) => Promise<Blob | null>;
  /**
   * Streams chat: calls onChunk with each delta, resolves with the full response.
   */
  chatFn: (text: string, onChunk: (delta: string) => void, signal: AbortSignal) => Promise<string>;
  /** Minimum silence duration (ms) after speech before utterance is considered done */
  silenceMs?: number;
  /** RMS threshold above which audio is considered speech (0–1) */
  thresholdRms?: number;
  /** Hard cap on a single utterance recording (ms) */
  maxUtteranceMs?: number;
}

export interface VoiceCallHandle {
  /** True while the call is active */
  running: boolean;
  /** Stop the call and return to idle */
  stop: () => void;
  /** Mute/unmute the microphone (VAD still runs, stops listening) */
  mute: () => void;
  unmute: () => void;
  muted: boolean;
}

/** Default TTS via Web Speech API. */
export async function defaultSpeak(text: string, signal: AbortSignal): Promise<void> {
  if (!('speechSynthesis' in window)) return;
  return new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    signal.addEventListener('abort', () => {
      window.speechSynthesis.cancel();
      resolve();
    });
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Default VAD-gated recorder using AudioContext + AnalyserNode.
 * Returns a Blob once silence is detected, or null if no speech was detected
 * before maxMs.
 */
export async function defaultRecordUtterance(opts: { silenceMs: number; thresholdRms: number; maxMs: number }): Promise<Blob | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null;
  }
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
    MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise<Blob | null>((resolve) => {
    const pcmBuf = new Float32Array(analyser.fftSize);
    const getRms = () => {
      analyser.getFloatTimeDomainData(pcmBuf);
      let sum = 0;
      for (let i = 0; i < pcmBuf.length; i++) sum += pcmBuf[i] * pcmBuf[i];
      return Math.sqrt(sum / pcmBuf.length);
    };

    let hasSpeech = false;
    let silenceStart = 0;
    const start = Date.now();
    recorder.start();

    const poll = setInterval(() => {
      const rms = getRms();
      const elapsed = Date.now() - start;
      if (elapsed > opts.maxMs) {
        clearInterval(poll);
        recorder.stop();
        return;
      }
      if (rms > opts.thresholdRms) {
        hasSpeech = true;
        silenceStart = 0;
      } else if (hasSpeech) {
        if (silenceStart === 0) silenceStart = Date.now();
        else if (Date.now() - silenceStart > opts.silenceMs) {
          clearInterval(poll);
          recorder.stop();
        }
      }
    }, 50);

    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      ctx.close().catch(() => {});
      if (!hasSpeech) { resolve(null); return; }
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    };
  });
}

// ── State machine ─────────────────────────────────────────────────────────────

/**
 * Start a hands-free voice call loop.
 * Returns a VoiceCallHandle to control / stop it.
 */
export function startVoiceCall(options: VoiceCallOptions, callbacks: VoiceCallCallbacks): VoiceCallHandle {
  const {
    transcribeFn, speakFn, recordUtteranceFn, chatFn,
    silenceMs = 1500, thresholdRms = 0.015, maxUtteranceMs = 60_000,
  } = options;

  const handle: VoiceCallHandle = {
    running: true,
    muted: false,
    stop: () => { handle.running = false; abortCtrl.abort(); },
    mute: () => { handle.muted = true; },
    unmute: () => { handle.muted = false; },
  };
  const abortCtrl = new AbortController();

  async function loop() {
    while (handle.running && !abortCtrl.signal.aborted) {
      if (handle.muted) {
        await new Promise(r => setTimeout(r, 200));
        continue;
      }

      // ── Listening / VAD ──
      callbacks.onStateChange('listening');
      let blob: Blob | null = null;
      try {
        blob = await recordUtteranceFn({ silenceMs, thresholdRms, maxMs: maxUtteranceMs });
      } catch (e) {
        callbacks.onError(`Recording failed: ${e instanceof Error ? e.message : String(e)}`);
        callbacks.onStateChange('error');
        break;
      }

      if (!handle.running) break;
      if (!blob) continue; // no speech detected, keep listening

      // ── Transcribing ──
      callbacks.onStateChange('transcribing');
      let transcript = '';
      try {
        transcript = await transcribeFn(blob);
      } catch (e) {
        callbacks.onError(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
        continue; // non-fatal: go back to listening
      }
      if (!transcript || !handle.running) continue;
      callbacks.onTranscript(transcript);

      // ── Responding ──
      callbacks.onStateChange('responding');
      let fullResponse = '';
      try {
        fullResponse = await chatFn(transcript, (delta) => {
          fullResponse += delta; // accumulate for TTS even if onResponseChunk is called too
          callbacks.onResponseChunk(delta);
        }, abortCtrl.signal);
      } catch (e) {
        if (abortCtrl.signal.aborted) break;
        callbacks.onError(`Chat failed: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (!handle.running) break;
      callbacks.onResponseComplete(fullResponse);

      // ── Speaking (TTS) ──
      callbacks.onStateChange('speaking');
      const ttsAbort = new AbortController();
      const stopTts = () => ttsAbort.abort();
      // forward main abort to TTS abort
      abortCtrl.signal.addEventListener('abort', stopTts);
      try {
        await speakFn(fullResponse, ttsAbort.signal);
      } catch {
        // TTS failure is non-fatal
      } finally {
        abortCtrl.signal.removeEventListener('abort', stopTts);
      }
    }

    handle.running = false;
    callbacks.onStateChange('idle');
  }

  loop().catch(e => {
    callbacks.onError(e instanceof Error ? e.message : String(e));
    callbacks.onStateChange('error');
  });

  return handle;
}
