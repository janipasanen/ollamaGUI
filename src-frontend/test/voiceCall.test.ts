import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startVoiceCall, type CallState, type VoiceCallOptions, type VoiceCallCallbacks } from '../services/voiceCall';

// Helper: build mock options
function mockOptions(overrides: Partial<VoiceCallOptions> = {}): VoiceCallOptions {
  return {
    transcribeFn: vi.fn().mockResolvedValue('hello'),
    speakFn: vi.fn().mockResolvedValue(undefined),
    recordUtteranceFn: vi.fn().mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' })),
    chatFn: vi.fn().mockImplementation(async (_text, onChunk, _signal) => {
      onChunk('Hi ');
      onChunk('there!');
      return 'Hi there!';
    }),
    ...overrides,
  };
}

// Helper: build callbacks with state tracker
function mockCallbacks(): { callbacks: VoiceCallCallbacks; states: CallState[]; transcripts: string[]; responses: string[] } {
  const states: CallState[] = [];
  const transcripts: string[] = [];
  const responses: string[] = [];
  const callbacks: VoiceCallCallbacks = {
    onStateChange: vi.fn((s) => states.push(s)),
    onTranscript: vi.fn((t) => transcripts.push(t)),
    onResponseChunk: vi.fn(),
    onResponseComplete: vi.fn((r) => responses.push(r)),
    onError: vi.fn(),
  };
  return { callbacks, states, transcripts, responses };
}

describe('startVoiceCall state machine (#132)', () => {
  it('transitions through listening → transcribing → responding → speaking → listening', async () => {
    const opts = mockOptions();
    const { callbacks, states } = mockCallbacks();

    // Let it run one full loop then stop
    let iteration = 0;
    (opts.recordUtteranceFn as any).mockImplementation(async () => {
      if (iteration++ >= 1) {
        handle.stop();
        return null;
      }
      return new Blob(['audio'], { type: 'audio/webm' });
    });

    const handle = startVoiceCall(opts, callbacks);
    // Wait for the loop to terminate
    await new Promise(r => setTimeout(r, 50));

    expect(states).toContain('listening');
    expect(states).toContain('transcribing');
    expect(states).toContain('responding');
    expect(states).toContain('speaking');
    expect(states[states.length - 1]).toBe('idle');
  });

  it('records transcript and full response', async () => {
    const opts = mockOptions();
    const { callbacks, transcripts, responses } = mockCallbacks();

    let iteration = 0;
    (opts.recordUtteranceFn as any).mockImplementation(async () => {
      if (iteration++ >= 1) { handle.stop(); return null; }
      return new Blob(['audio'], { type: 'audio/webm' });
    });

    const handle = startVoiceCall(opts, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(transcripts).toEqual(['hello']);
    expect(responses).toEqual(['Hi there!']);
  });

  it('skips to listening when no speech detected (blob is null)', async () => {
    const opts = mockOptions({
      recordUtteranceFn: vi.fn().mockImplementation(async () => {
        handle.stop();
        return null;
      }),
    });
    const { callbacks, states } = mockCallbacks();
    const handle = startVoiceCall(opts, callbacks);
    await new Promise(r => setTimeout(r, 50));

    // transcribeFn should NOT have been called
    expect(opts.transcribeFn).not.toHaveBeenCalled();
    expect(states).toContain('listening');
  });

  it('stop() terminates the loop and emits idle', async () => {
    const opts = mockOptions({
      recordUtteranceFn: vi.fn(async () => {
        handle.stop();
        return null;
      }),
    });
    const { callbacks, states } = mockCallbacks();
    const handle = startVoiceCall(opts, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(handle.running).toBe(false);
    expect(states[states.length - 1]).toBe('idle');
  });

  it('transcription failure is non-fatal: loop continues to next listen', async () => {
    let call = 0;
    const opts = mockOptions({
      transcribeFn: vi.fn().mockRejectedValue(new Error('STT error')),
      recordUtteranceFn: vi.fn().mockImplementation(async () => {
        if (call++ >= 1) { handle.stop(); return null; }
        return new Blob(['audio'], { type: 'audio/webm' });
      }),
    });
    const { callbacks } = mockCallbacks();
    const handle = startVoiceCall(opts, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('STT error'));
    expect(handle.running).toBe(false); // stopped by our mock
  });

  it('chat failure is non-fatal: loop continues to next listen', async () => {
    let call = 0;
    const opts = mockOptions({
      chatFn: vi.fn().mockRejectedValue(new Error('chat down')),
      recordUtteranceFn: vi.fn().mockImplementation(async () => {
        if (call++ >= 1) { handle.stop(); return null; }
        return new Blob(['audio'], { type: 'audio/webm' });
      }),
    });
    const { callbacks } = mockCallbacks();
    const handle = startVoiceCall(opts, callbacks);
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('chat down'));
    expect(handle.running).toBe(false);
  });

  it('barge-in: stop() during speaking cancels TTS and exits', async () => {
    let ttsAborted = false;
    const opts = mockOptions({
      speakFn: vi.fn().mockImplementation(async (_text, signal: AbortSignal) => {
        return new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { ttsAborted = true; resolve(); });
          // TTS would run forever unless aborted
        });
      }),
      recordUtteranceFn: vi.fn().mockResolvedValue(new Blob(['audio'])),
    });
    const { callbacks } = mockCallbacks();
    const handle = startVoiceCall(opts, callbacks);

    // Wait for TTS to start
    await new Promise(r => setTimeout(r, 30));
    handle.stop();
    await new Promise(r => setTimeout(r, 30));

    expect(ttsAborted).toBe(true);
    expect(handle.running).toBe(false);
  });

  it('mute() prevents further recordings after current speak ends', async () => {
    let speakResolve!: () => void;
    const opts = mockOptions({
      speakFn: vi.fn().mockImplementation(async (_text: string, signal: AbortSignal) => {
        return new Promise<void>((resolve) => {
          speakResolve = resolve;
          signal.addEventListener('abort', resolve);
        });
      }),
    });
    const { callbacks } = mockCallbacks();
    const handle = startVoiceCall(opts, callbacks);

    // Wait for TTS phase to begin
    await new Promise(r => setTimeout(r, 40));
    // Mute while still speaking
    handle.mute();
    // Release TTS
    speakResolve();
    // Wait for loop to cycle back — it should poll the muted branch, not record
    await new Promise(r => setTimeout(r, 60));
    // recordUtteranceFn should have been called exactly once (the initial recording)
    expect(opts.recordUtteranceFn).toHaveBeenCalledTimes(1);
    handle.stop();
    await new Promise(r => setTimeout(r, 20));
  });
});
