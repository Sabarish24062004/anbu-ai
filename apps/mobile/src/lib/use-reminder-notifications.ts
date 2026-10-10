import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { getPermission, requestPermission, scheduleReminders } from './notifications';
import { useUpcomingReminders } from './queries';
import { useSession, useT } from './session-context';

function openFromNotification(response: Notifications.NotificationResponse) {
  const path = response.notification.request.content.data?.['path'];
  if (typeof path === 'string' && path.startsWith('/')) router.push(path as never);
}

/**
 * Keeps the phone's local notifications in step with the server's upcoming reminders, asks for
 * notification permission once, and opens the related screen when a notification is tapped.
 * Mounted once in the signed-in layout.
 */
export function useReminderNotifications() {
  const t = useT();
  const { language } = useSession();
  const upcoming = useUpcomingReminders();
  const asked = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web' || asked.current) return;
    asked.current = true;
    void getPermission().then((state) => (state === 'undetermined' ? requestPermission() : state));
  }, []);

  useEffect(() => {
    if (!upcoming.data) return;
    scheduleReminders(upcoming.data.reminders, t, language).catch(() => {
      // Without permission scheduling fails; reminders still appear in the app's "due now" list.
    });
  }, [upcoming.data, t, language]);

  // A tap that launched the app from a closed state.
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!last) return;
    openFromNotification(last);
    void Notifications.clearLastNotificationResponseAsync();
  }, [last]);

  // Taps while the app is running or in the background.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    return () => sub.remove();
  }, []);
}
