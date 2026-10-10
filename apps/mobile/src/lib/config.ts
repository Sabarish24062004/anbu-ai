import Constants from 'expo-constants';

const API_PORT = 4000;

/**
 * Resolves the backend URL.
 * 1. EXPO_PUBLIC_API_URL if set (e.g. a deployed API).
 * 2. In development, the LAN IP of the machine running the Expo dev server. The API runs on the
 *    same machine, so a phone on the same Wi-Fi can reach it.
 */
export function getApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.5:8081"
  const host = hostUri?.split(':')[0] ?? 'localhost';
  return `http://${host}:${API_PORT}`;
}

export const APP_NAME = Constants.expoConfig?.name ?? 'Anbu AI';
