import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

let registeredToken: string | null = null;

/** The EAS project id; only present once the app is set up for EAS builds (`eas init`). */
const projectId = (): string | undefined =>
  Constants.easConfig?.projectId ??
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;

/**
 * Registers this phone for remote push when it can receive it (a development or store build with
 * an EAS project id). Returns false in Expo Go and on any failure; the app then keeps using local
 * notifications, so reminders work either way.
 */
export async function registerForPush(): Promise<boolean> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  // Expo Go cannot receive remote push (and on Android its push code throws when loaded).
  if (isRunningInExpoGo()) return false;
  const id = projectId();
  if (!id) return false;
  try {
    // Loaded on demand: this module pulls in expo-notifications' push-token side effects.
    const { getExpoPushTokenAsync } =
      await import('expo-notifications/build/getExpoPushTokenAsync');
    const { data: token } = await getExpoPushTokenAsync({ projectId: id });
    await api.registerDevice({
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
      pushToken: token,
      deviceName: Constants.deviceName ?? undefined,
      permissionStatus: 'granted',
    });
    registeredToken = token;
    return true;
  } catch {
    return false; // e.g. Expo Go on Android, offline, or push credentials not set up yet
  }
}

/** Stops push to this phone for the signed-in account (call before signing out). */
export async function unregisterPush() {
  const token = registeredToken;
  registeredToken = null;
  if (token) await api.unregisterDevice(token).catch(() => undefined);
}
