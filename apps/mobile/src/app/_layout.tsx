import {
  focusManager,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform, View } from 'react-native';
import { ApiError } from '@/lib/http';
import { SessionProvider, useSession } from '@/lib/session-context';
import { useColors } from '@/theme/colors';

// Keep the splash screen up until the saved session has been read, so the sign-in screen does not
// flash for someone who is already signed in. RootNavigator hides it explicitly.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// React Query refetches stale data on focus; on native, "focus" is the app returning to the
// foreground (e.g. reopening the app picks up reminders changed elsewhere).
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
    return () => sub.remove();
  });
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Do not hammer the server with retries for errors a retry cannot fix.
            retry: (count, err) =>
              count < 2 && !(err instanceof ApiError && err.kind === 'http' && err.status! < 500),
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <StatusBar style="auto" />
        <WebFrame>
          <RootNavigator />
        </WebFrame>
      </SessionProvider>
    </QueryClientProvider>
  );
}

/** On a wide browser window, show the app as a centred phone-width column; elsewhere a no-op. */
function WebFrame({ children }: { children: ReactNode }) {
  const colors = useColors();
  if (Platform.OS !== 'web') return children;
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: colors.border }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 480, backgroundColor: colors.background }}>
        {children}
      </View>
    </View>
  );
}

function RootNavigator() {
  const { session, isLoading } = useSession();
  const colors = useColors();
  const queryClient = useQueryClient();
  const signedIn = !!session;

  // Never show one account's cached data to the next person who signs in.
  useEffect(() => {
    if (!signedIn) queryClient.clear();
  }, [signedIn, queryClient]);

  useEffect(() => {
    if (!isLoading) void SplashScreen.hideAsync().catch(() => undefined);
  }, [isLoading]);

  // On the web there is no splash screen, and rendering the guarded routes before the saved
  // session is read would redirect a reloaded page (e.g. /settings) to sign-in and then to the
  // Agenda. Reading localStorage takes a moment, so show an empty page until then.
  if (isLoading && Platform.OS === 'web') {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  // On phones the navigator is always rendered: Expo Router only finishes starting up once a
  // navigator has mounted, so returning anything else can leave the app stuck on the splash screen.
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="register" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
