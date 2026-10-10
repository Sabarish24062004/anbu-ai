import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { VOICE_MAX_SECONDS, type Language } from '@anbu/shared';

/**
 * Speech is short and only needs to be understood, so record mono AAC at a low rate:
 * about 240 KB per minute instead of ~1 MB with the high-quality preset.
 */
const VOICE_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
};

export const voiceSupported = Platform.OS === 'ios' || Platform.OS === 'android';

export type RecordingResult = { base64: string; mimeType: 'audio/m4a'; seconds: number };

/**
 * Tap-to-talk recorder. `start` asks for the microphone, `finish` returns the recording as base64
 * (and deletes the file: the audio is not kept on the phone), `discard` throws it away. Recording
 * stops by itself at the length limit; `onLimit` then receives the result.
 */
export function useVoiceRecorder(onLimit: (r: RecordingResult) => void) {
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const state = useAudioRecorderState(recorder, 250);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const busy = useRef(false);

  const start = useCallback(async () => {
    if (busy.current || state.isRecording) return false;
    const status = await requestRecordingPermissionsAsync();
    setPermission(status.granted ? 'granted' : 'denied');
    if (!status.granted) return false;
    await Speech.stop(); // never record the app's own voice
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    return true;
  }, [recorder, state.isRecording]);

  const stopAndRead = useCallback(
    async (keep: boolean): Promise<RecordingResult | null> => {
      if (busy.current) return null;
      busy.current = true;
      try {
        const seconds = Math.round(recorder.getStatus().durationMillis / 1000);
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        const uri = recorder.uri;
        if (!uri) return null;
        const file = new File(uri);
        try {
          return keep ? { base64: await file.base64(), mimeType: 'audio/m4a', seconds } : null;
        } finally {
          if (file.exists) file.delete();
        }
      } finally {
        busy.current = false;
      }
    },
    [recorder],
  );

  const finish = useCallback(() => stopAndRead(true), [stopAndRead]);
  const discard = useCallback(() => stopAndRead(false).then(() => undefined), [stopAndRead]);

  // Enforce the length limit the server also enforces.
  const limitHit = state.isRecording && state.durationMillis >= VOICE_MAX_SECONDS * 1000;
  const onLimitRef = useRef(onLimit);
  useEffect(() => {
    onLimitRef.current = onLimit;
  });
  useEffect(() => {
    if (!limitHit) return;
    void finish().then((r) => r && onLimitRef.current(r));
  }, [limitHit, finish]);

  return {
    isRecording: state.isRecording,
    seconds: Math.floor(state.durationMillis / 1000),
    permission,
    start,
    finish,
    discard,
  };
}

// ---------------------------------------------------------------------------------------------
// Speaking replies

const BCP47: Record<Language, string> = { ta: 'ta-IN', en: 'en-IN' };
let voicesPromise: Promise<Speech.Voice[]> | null = null;

const voices = () => {
  voicesPromise ??= Speech.getAvailableVoicesAsync().catch(() => []);
  return voicesPromise;
};

/** The best installed voice for a language (an Indian accent first), if the phone has one. */
async function voiceFor(lang: Language): Promise<Speech.Voice | undefined> {
  const all = await voices();
  const matches = all.filter((v) => v.language.replace('_', '-').toLowerCase().startsWith(lang));
  return (
    matches.find((v) => /-in$/i.test(v.language.replace('_', '-'))) ??
    matches.find((v) => v.quality === Speech.VoiceQuality.Enhanced) ??
    matches[0]
  );
}

/** Whether the phone can speak this language. Many Android phones lack a Tamil voice by default. */
export async function canSpeak(lang: Language): Promise<boolean> {
  return (await voiceFor(lang)) !== undefined;
}

export async function speak(text: string, lang: Language) {
  if (!voiceSupported || !text.trim()) return;
  const voice = await voiceFor(lang);
  await Speech.stop();
  // Bullets and quotes read badly aloud.
  const spoken = text.replace(/[•“”"]/g, '').replace(/\n+/g, '. ');
  Speech.speak(spoken.slice(0, Speech.maxSpeechInputLength || 4000), {
    language: voice?.language ?? BCP47[lang],
    voice: voice?.identifier,
    rate: 0.95,
  });
}

export const stopSpeaking = () => Speech.stop();
