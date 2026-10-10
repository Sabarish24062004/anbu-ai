import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AuthResponse, AuthTokens, UserDto } from '@anbu/shared';
import { sendJson } from './http';

const STORAGE_KEY = 'anbu.session';
// Refresh slightly early so a request never leaves with a token about to expire.
const EXPIRY_MARGIN_MS = 30_000;

export interface Session {
  user: UserDto;
  tokens: AuthTokens;
}

// expo-secure-store is native only; Expo web (development) falls back to localStorage.
const storage = {
  get: (): Promise<string | null> =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.getItem(STORAGE_KEY) ?? null)
      : SecureStore.getItemAsync(STORAGE_KEY),
  set: (value: string): Promise<void> =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.setItem(STORAGE_KEY, value))
      : SecureStore.setItemAsync(STORAGE_KEY, value),
  remove: (): Promise<void> =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.removeItem(STORAGE_KEY))
      : SecureStore.deleteItemAsync(STORAGE_KEY),
};

let current: Session | null = null;
let refreshing: Promise<string | null> | null = null;
const listeners = new Set<(s: Session | null) => void>();

function emit() {
  for (const fn of listeners) fn(current);
}

async function persist(next: Session | null) {
  current = next;
  emit();
  try {
    if (next) await storage.set(JSON.stringify(next));
    else await storage.remove();
  } catch {
    // Storage failure only costs persistence across restarts; the in-memory session still works.
  }
}

async function doRefresh(): Promise<string | null> {
  const session = current;
  if (!session) return null;
  const res = await sendJson('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: session.tokens.refreshToken },
  });
  if (res.status === 200) {
    const auth = res.body as AuthResponse;
    await persist({ user: auth.user, tokens: auth.tokens });
    return auth.tokens.accessToken;
  }
  // The refresh token is expired, revoked or reused: the user must sign in again.
  if (res.status === 401) await persist(null);
  return null;
}

/**
 * Holds the signed-in session outside React so the API client can read and refresh tokens.
 * Refreshes are single-flight: the server treats a refresh token presented twice as stolen.
 */
export const sessionStore = {
  get: () => current,

  subscribe(fn: (s: Session | null) => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  async load(): Promise<Session | null> {
    try {
      const raw = await storage.get();
      current = raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      current = null;
    }
    emit();
    return current;
  },

  signIn: (auth: AuthResponse) => persist({ user: auth.user, tokens: auth.tokens }),

  setUser: (user: UserDto) => (current ? persist({ ...current, user }) : Promise.resolve()),

  async signOut() {
    const session = current;
    await persist(null);
    if (session) {
      // Best effort: revoke the refresh token on the server; signing out locally is what matters.
      sendJson('/auth/logout', {
        method: 'POST',
        body: { refreshToken: session.tokens.refreshToken },
      }).catch(() => undefined);
    }
  },

  refreshAccessToken(): Promise<string | null> {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  },

  async getAccessToken(): Promise<string | null> {
    if (!current) return null;
    const expiresAt = Date.parse(current.tokens.accessTokenExpiresAt);
    if (expiresAt - Date.now() > EXPIRY_MARGIN_MS) return current.tokens.accessToken;
    return this.refreshAccessToken();
  },
};
