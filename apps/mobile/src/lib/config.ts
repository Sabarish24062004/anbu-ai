import Constants from 'expo-constants';
import { API_PORT } from './address';

export { normalizeServerAddress } from './address';

// Set from the saved "server address" setting at startup (see server-address.ts).
let override: string | null = null;

export function setApiBaseUrlOverride(url: string | null) {
  override = url;
}

/**
 * Resolves the backend URL.
 * 1. The server address the user saved in the app (installed builds have no dev server to ask).
 * 2. EXPO_PUBLIC_API_URL, baked in at build time.
 * 3. In development, the LAN IP of the machine running the Expo dev server. The API runs on the
 *    same machine, so a phone on the same Wi-Fi can reach it.
 */
export function getApiBaseUrl(): string {
  if (override) return override;
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.5:8081"
  const host = hostUri?.split(':')[0] ?? 'localhost';
  return `http://${host}:${API_PORT}`;
}

export const APP_NAME = Constants.expoConfig?.name ?? 'Anbu AI';
