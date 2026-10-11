import {
  focusManager,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
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
        <RootNavigator />
      </SessionProvider>
    </QueryClientProvider>
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

  // The navigator is always rendered: Expo Router only finishes starting up once a navigator has
  // mounted, so returning anything else here can leave the app stuck on the splash screen.
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
