import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { addDays, startOfToday, toLocalDateString } from './datetime';
import {
  getPermission,
  requestPermission,
  scheduleDailyBrief,
  scheduleReminders,
} from './notifications';
import { registerForPush } from './push';
import { useDayPlan, useMe, useUpcomingReminders } from './queries';
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

  // The next morning brief: today's wake time if still ahead, otherwise tomorrow's.
  const me = useMe();
  const briefOn = me.data?.preferences.dailyBriefEnabled ?? false;
  const wake = me.data?.preferences.wakeMinutes ?? 7 * 60;
  const todayWake = startOfToday().getTime() + wake * 60_000;
  // "Now" is when reminders were last synced (every 15 min and on reopening): keeps render pure.
  const syncedAt = upcoming.dataUpdatedAt;
  const briefDay = syncedAt < todayWake ? startOfToday() : addDays(startOfToday(), 1);
  const briefAt = new Date(briefDay.getTime() + wake * 60_000);
  const briefPlan = useDayPlan(toLocalDateString(briefDay), briefOn);

  // With remote push the server alerts this phone itself, so local copies would arrive twice.
  const [pushActive, setPushActive] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web' || asked.current) return;
    asked.current = true;
    void getPermission()
      .then((state) => (state === 'undetermined' ? requestPermission() : state))
      .then((state) => (state === 'granted' ? registerForPush() : false))
      .then(setPushActive);
  }, []);

  const briefAtMs = briefAt.getTime();
  useEffect(() => {
    if (!upcoming.data) return;
    const run = async () => {
      await scheduleReminders(pushActive ? [] : upcoming.data.reminders, t, language);
      if (briefOn && briefPlan.data) {
        await scheduleDailyBrief(new Date(briefAtMs), briefPlan.data.plan, t, language);
      }
    };
    run().catch(() => {
      // Without permission scheduling fails; reminders still appear in the app's "due now" list.
    });
  }, [upcoming.data, pushActive, briefOn, briefPlan.data, briefAtMs, t, language]);

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
