/*
 * Browser version of voice.ts (Metro picks this file on web). Same exports, built on browser APIs:
 * MediaRecorder for the microphone and speechSynthesis for reading replies aloud.
 *
 * Browsers record WebM (Chrome, Firefox) or MP4 (Safari), and Gemini's documented audio formats
 * include neither WebM nor every MP4 variant, so the recording is decoded and re-encoded as 16 kHz
 * mono WAV before it is sent: about 32 KB per second, so 60 s stays under VOICE_MAX_BYTES.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_MAX_SECONDS, type Language } from '@anbu/shared';
import type { RecordingResult } from './voice';

export type { RecordingResult };

const SAMPLE_RATE = 16_000;

// The microphone needs a secure page (https:// or localhost); elsewhere the button is hidden.
export const voiceSupported =
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  typeof MediaRecorder !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia;

/** 16-bit PCM WAV from mono samples in [-1, 1]. */
function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return buffer;
}

/** Decodes the browser's recording and resamples it to 16 kHz mono WAV. */
async function toWav(blob: Blob): Promise<ArrayBuffer> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, Math.max(frames, 1), SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination); // a mono destination downmixes the channels
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0), SAMPLE_RATE);
  } finally {
    void ctx.close();
  }
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Tap-to-talk recorder with the same contract as the native one (see voice.ts). */
export function useVoiceRecorder(onLimit: (r: RecordingResult) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const recorder = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);
  const busy = useRef(false);

  const start = useCallback(async () => {
    if (busy.current || recorder.current) return false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPermission('denied');
      return false;
    }
    setPermission('granted');
    window.speechSynthesis?.cancel(); // never record the app's own voice
    const rec = new MediaRecorder(stream);
    rec.start();
    recorder.current = rec;
    startedAt.current = Date.now();
    setSeconds(0);
    setIsRecording(true);
    return true;
  }, []);

  const stopAndRead = useCallback(async (keep: boolean): Promise<RecordingResult | null> => {
    const rec = recorder.current;
    if (busy.current || !rec) return null;
    busy.current = true;
    try {
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const stopped = new Promise((resolve) => (rec.onstop = resolve));
      rec.stop();
      await stopped;
      rec.stream.getTracks().forEach((track) => track.stop()); // turns the mic indicator off
      const secs = Math.round((Date.now() - startedAt.current) / 1000);
      if (!keep) return null;
      const wav = await toWav(new Blob(chunks, { type: rec.mimeType }));
      return { base64: toBase64(wav), mimeType: 'audio/wav', seconds: secs };
    } finally {
      recorder.current = null;
      setIsRecording(false);
      busy.current = false;
    }
  }, []);

  const finish = useCallback(() => stopAndRead(true), [stopAndRead]);
  const discard = useCallback(() => stopAndRead(false).then(() => undefined), [stopAndRead]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)),
      250,
    );
    return () => clearInterval(timer);
  }, [isRecording]);

  // Enforce the length limit the server also enforces.
  const limitHit = isRecording && seconds >= VOICE_MAX_SECONDS;
  const onLimitRef = useRef(onLimit);
  useEffect(() => {
    onLimitRef.current = onLimit;
  });
  useEffect(() => {
    if (!limitHit) return;
    void finish().then((r) => r && onLimitRef.current(r));
  }, [limitHit, finish]);

  // Release the microphone if the screen goes away mid-recording.
  useEffect(
    () => () => {
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  return { isRecording, seconds, permission, start, finish, discard };
}

// ---------------------------------------------------------------------------------------------
// Speaking replies

const BCP47: Record<Language, string> = { ta: 'ta-IN', en: 'en-IN' };

/** The browser loads its voice list asynchronously; wait briefly for it. */
function voices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1_000);
  });
}

async function voiceFor(lang: Language): Promise<SpeechSynthesisVoice | undefined> {
  const matches = (await voices()).filter((v) => v.lang.toLowerCase().startsWith(lang));
  return matches.find((v) => /-in$/i.test(v.lang)) ?? matches[0];
}

/** Whether the browser can speak this language. Few desktop browsers have a Tamil voice. */
export async function canSpeak(lang: Language): Promise<boolean> {
  return (await voiceFor(lang)) !== undefined;
}

export async function speak(text: string, lang: Language) {
  const synth = window.speechSynthesis;
  if (!synth || !text.trim()) return;
  const voice = await voiceFor(lang);
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(
    text
      .replace(/[•“”"]/g, '')
      .replace(/\n+/g, '. ')
      .slice(0, 4000),
  );
  utterance.lang = voice?.lang ?? BCP47[lang];
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;
  synth.speak(utterance);
}

export const stopSpeaking = async () => {
  window.speechSynthesis?.cancel();
};
