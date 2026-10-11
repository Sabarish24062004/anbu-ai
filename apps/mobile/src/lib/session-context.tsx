import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_LANGUAGE, type AuthResponse, type Language } from '@anbu/shared';
import { STRINGS, type Strings } from '@/i18n/strings';
import { clearScheduledReminders } from './notifications';
import { unregisterPush } from './push';
import { loadServerAddress } from './server-address';
import { sessionStore, type Session } from './session';

interface SessionContextValue {
  isLoading: boolean;
  session: Session | null;
  signIn: (auth: AuthResponse) => Promise<void>;
  signOut: () => Promise<void>;
  /** UI language: the signed-in user's choice, or a local choice on the sign-in screens. */
  language: Language;
  setLanguage: (lang: Language) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [isLoading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [localLanguage, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    const unsubscribe = sessionStore.subscribe(setSession);
    // The server address must be known before anything talks to the API.
    void loadServerAddress()
      .then(() => sessionStore.load())
      .finally(() => setLoading(false));
    return () => {
      unsubscribe();
    };
  }, []);

  const signIn = useCallback((auth: AuthResponse) => sessionStore.signIn(auth), []);
  const signOut = useCallback(async () => {
    // The next person to use this phone must not get this account's reminders.
    await clearScheduledReminders().catch(() => undefined);
    await unregisterPush(); // needs the session, so before signing out
    await sessionStore.signOut();
  }, []);

  const value = useMemo(
    () => ({
      isLoading,
      session,
      signIn,
      signOut,
      language: session?.user.language ?? localLanguage,
      setLanguage,
    }),
    [isLoading, session, signIn, signOut, localLanguage],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

export function useT(): Strings {
  return STRINGS[useSession().language];
}
