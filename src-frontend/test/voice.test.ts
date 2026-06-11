import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadVoiceSettings, saveVoiceSettings,
  recognize, speak, stopSpeaking, isSpeechRecognitionAvailable, isTtsAvailable,
  _setRecognizeFn, _setSpeakFn,
  type VoiceSettings,
} from '../services/voice';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  // Reset injected fns to defaults
  _setRecognizeFn(async () => '');
  _setSpeakFn(async () => {});
});

// ── Persistence ────────────────────────────────────────────────────────────────

describe('loadVoiceSettings / saveVoiceSettings (#101)', () => {
  it('returns defaults when nothing is stored', () => {
    const s = loadVoiceSettings();
    expect(s.autoSpeak).toBe(false);
    expect(s.rate).toBe(1);
    expect(s.pitch).toBe(1);
  });

  it('round-trips settings through localStorage', () => {
    const s: VoiceSettings = { autoSpeak: true, rate: 1.5, pitch: 0.8, voiceURI: 'com.apple.voice.compact.en-US.Samantha' };
    saveVoiceSettings(s);
    expect(loadVoiceSettings()).toEqual(s);
  });

  it('merges stored values with defaults', () => {
    localStorage.setItem('voice_settings', JSON.stringify({ autoSpeak: true }));
    const s = loadVoiceSettings();
    expect(s.autoSpeak).toBe(true);
    expect(s.rate).toBe(1); // default
  });
});

// ── STT recognize ─────────────────────────────────────────────────────────────

describe('recognize (#101)', () => {
  it('returns the transcribed text from the injected recognizer', async () => {
    _setRecognizeFn(async () => 'hello world');
    expect(await recognize()).toBe('hello world');
  });

  it('returns empty string when no speech detected', async () => {
    _setRecognizeFn(async () => '');
    expect(await recognize()).toBe('');
  });

  it('propagates recognizer errors', async () => {
    _setRecognizeFn(async () => { throw new Error('no-speech'); });
    await expect(recognize()).rejects.toThrow('no-speech');
  });
});

// ── TTS speak ─────────────────────────────────────────────────────────────────

describe('speak (#101)', () => {
  it('calls the injected speak function with text and settings', async () => {
    const spyFn = vi.fn().mockResolvedValue(undefined);
    _setSpeakFn(spyFn);
    const settings: VoiceSettings = { autoSpeak: true, rate: 1.2, pitch: 0.9 };
    await speak('hello', settings);
    expect(spyFn).toHaveBeenCalledWith('hello', settings);
  });

  it('loads settings from localStorage when none provided', async () => {
    saveVoiceSettings({ autoSpeak: true, rate: 1.5, pitch: 1 });
    const captured: VoiceSettings[] = [];
    _setSpeakFn(async (_t, s) => { captured.push(s); });
    await speak('test');
    expect(captured[0].rate).toBe(1.5);
  });
});

// ── isSpeechRecognitionAvailable / isTtsAvailable ──────────────────────────────

describe('API availability checks (#101)', () => {
  it('isSpeechRecognitionAvailable returns false when SpeechRecognition is absent', () => {
    const orig = (window as any).SpeechRecognition;
    const origWk = (window as any).webkitSpeechRecognition;
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
    expect(isSpeechRecognitionAvailable()).toBe(false);
    (window as any).SpeechRecognition = orig;
    (window as any).webkitSpeechRecognition = origWk;
  });

  it('isSpeechRecognitionAvailable returns true when webkitSpeechRecognition is present', () => {
    const orig = (window as any).SpeechRecognition;
    delete (window as any).SpeechRecognition;
    (window as any).webkitSpeechRecognition = class {};
    expect(isSpeechRecognitionAvailable()).toBe(true);
    (window as any).SpeechRecognition = orig;
    delete (window as any).webkitSpeechRecognition;
  });

  it('isTtsAvailable returns true when speechSynthesis is on window', () => {
    const orig = (window as any).speechSynthesis;
    (window as any).speechSynthesis = { speak: vi.fn(), cancel: vi.fn(), speaking: false, getVoices: () => [] };
    expect(isTtsAvailable()).toBe(true);
    (window as any).speechSynthesis = orig;
  });

  it('isTtsAvailable returns false when speechSynthesis is absent', () => {
    const orig = (window as any).speechSynthesis;
    delete (window as any).speechSynthesis;
    expect(isTtsAvailable()).toBe(false);
    (window as any).speechSynthesis = orig;
  });
});

// ── stopSpeaking ──────────────────────────────────────────────────────────────

describe('stopSpeaking (#101)', () => {
  it('calls speechSynthesis.cancel() when available', () => {
    const cancel = vi.fn();
    (window as any).speechSynthesis = { cancel, speaking: false, speak: vi.fn(), getVoices: () => [] };
    stopSpeaking();
    expect(cancel).toHaveBeenCalled();
  });

  it('does not throw when speechSynthesis is absent', () => {
    const orig = (window as any).speechSynthesis;
    delete (window as any).speechSynthesis;
    expect(() => stopSpeaking()).not.toThrow();
    (window as any).speechSynthesis = orig;
  });
});
