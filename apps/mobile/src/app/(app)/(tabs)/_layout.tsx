import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform, type ColorValue } from 'react-native';
import { useT } from '@/lib/session-context';
import { useColors } from '@/theme/colors';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );

export default function TabsLayout() {
  const t = useT();
  const colors = useColors();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          ...(Platform.OS === 'web' && { height: 60 }),
        },
        // In the browser the default 49 px tab items clip the labels under the icons.
        ...(Platform.OS === 'web' && { tabBarItemStyle: { height: 60 } }),
        tabBarLabelStyle: { fontSize: 12 },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t.tabAgenda, tabBarIcon: icon('calendar-outline') }}
      />
      <Tabs.Screen
        name="assistant"
        options={{ title: t.tabAssistant, tabBarIcon: icon('chatbubbles-outline') }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ title: t.tabTasks, tabBarIcon: icon('checkbox-outline') }}
      />
      <Tabs.Screen name="dates" options={{ title: t.tabDates, tabBarIcon: icon('gift-outline') }} />
      <Tabs.Screen
        name="settings"
        options={{ title: t.tabSettings, tabBarIcon: icon('settings-outline') }}
      />
    </Tabs>
  );
}
