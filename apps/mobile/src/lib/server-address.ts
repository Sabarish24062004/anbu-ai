import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { setApiBaseUrlOverride } from './config';

const KEY = 'anbu.server';
const LOAD_TIMEOUT_MS = 3_000;

const store = {
  get: (): Promise<string | null> =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.getItem(KEY) ?? null)
      : SecureStore.getItemAsync(KEY),
  set: (v: string): Promise<void> =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.setItem(KEY, v))
      : SecureStore.setItemAsync(KEY, v),
  remove: (): Promise<void> =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.removeItem(KEY))
      : SecureStore.deleteItemAsync(KEY),
};

/** Applies the saved server address, if any. Called once at startup, before any API request. */
export async function loadServerAddress() {
  try {
    const saved = await Promise.race([
      store.get(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOAD_TIMEOUT_MS)),
    ]);
    setApiBaseUrlOverride(saved);
  } catch {
    setApiBaseUrlOverride(null);
  }
}

/** Saves (or, with null, forgets) the server address and uses it immediately. */
export async function saveServerAddress(url: string | null) {
  setApiBaseUrlOverride(url);
  try {
    if (url) await store.set(url);
    else await store.remove();
  } catch {
    // Not persisted, but still used for this session.
  }
}
