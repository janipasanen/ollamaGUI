/**
 * Voice input/output (#101) via browser Web Speech APIs.
 * Uses window.SpeechRecognition for STT and window.speechSynthesis for TTS.
 * All functions are injectable for testing (no real API calls needed in tests).
 */
const STORAGE_KEY = 'voice_settings';

export interface VoiceSettings {
  autoSpeak: boolean;
  voiceURI?: string;   // SpeechSynthesisVoice.voiceURI
  rate: number;        // 0.1 – 10, default 1
  pitch: number;       // 0 – 2, default 1
}

const DEFAULT_SETTINGS: VoiceSettings = {
  autoSpeak: false,
  rate: 1,
  pitch: 1,
};

// ── Persistence ────────────────────────────────────────────────────────────────

export function loadVoiceSettings(): VoiceSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveVoiceSettings(s: VoiceSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// ── STT (SpeechRecognition) seam ───────────────────────────────────────────────

export type RecognizeFn = () => Promise<string>;

/** Seam so tests can inject a mock recognizer */
let _recognizeFn: RecognizeFn = defaultRecognize;
export function _setRecognizeFn(fn: RecognizeFn): void { _recognizeFn = fn; }

export async function recognize(): Promise<string> {
  return _recognizeFn();
}

async function defaultRecognize(): Promise<string> {
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!Ctor) throw new Error('SpeechRecognition is not supported in this browser');
  return new Promise<string>((resolve, reject) => {
    const rec = new Ctor() as SpeechRecognition;
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join(' ').trim();
      resolve(text);
    };
    rec.onerror = (e: SpeechRecognitionErrorEvent) => reject(new Error(`SpeechRecognition error: ${e.error}`));
    rec.onend = () => resolve(''); // no result recorded
    rec.start();
  });
}

export function isSpeechRecognitionAvailable(): boolean {
  return !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition;
}

// ── TTS (speechSynthesis) seam ─────────────────────────────────────────────────

export type SpeakFn = (text: string, settings: VoiceSettings) => Promise<void>;

let _speakFn: SpeakFn = defaultSpeak;
export function _setSpeakFn(fn: SpeakFn): void { _speakFn = fn; }

export async function speak(text: string, settings?: VoiceSettings): Promise<void> {
  const s = settings ?? loadVoiceSettings();
  return _speakFn(text, s);
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

export function isSpeaking(): boolean {
  return 'speechSynthesis' in window && window.speechSynthesis.speaking;
}

export function isTtsAvailable(): boolean {
  return 'speechSynthesis' in window;
}

async function defaultSpeak(text: string, settings: VoiceSettings): Promise<void> {
  if (!isTtsAvailable()) return;
  window.speechSynthesis.cancel();
  return new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    if (settings.voiceURI) {
      const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === settings.voiceURI);
      if (voice) utterance.voice = voice;
    }
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!isTtsAvailable()) return [];
  return window.speechSynthesis.getVoices();
}
