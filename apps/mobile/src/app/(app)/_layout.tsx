import { Stack } from 'expo-router';
import { useT } from '@/lib/session-context';
import { useReminderNotifications } from '@/lib/use-reminder-notifications';
import { useColors } from '@/theme/colors';

export default function AppLayout() {
  const t = useT();
  const colors = useColors();
  useReminderNotifications();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="event/new" options={{ title: t.newEvent, presentation: 'modal' }} />
      <Stack.Screen name="event/[id]/index" options={{ title: t.event }} />
      <Stack.Screen name="event/[id]/edit" options={{ title: t.editEvent }} />
      <Stack.Screen name="task/new" options={{ title: t.newTask, presentation: 'modal' }} />
      <Stack.Screen name="task/[id]" options={{ title: t.editTask }} />
      <Stack.Screen name="date/new" options={{ title: t.newDate, presentation: 'modal' }} />
      <Stack.Screen name="date/[id]" options={{ title: t.editDate }} />
    </Stack>
  );
}
