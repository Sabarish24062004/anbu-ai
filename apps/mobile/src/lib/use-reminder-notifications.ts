import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as Notifications from './expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { ApiError } from './api-error';
import { Platform } from 'react-native';
import { addDays, startOfToday, toLocalDateString } from './datetime';
import {
  ACTION_DONE,
  ACTION_SNOOZE,
  getPermission,
  requestPermission,
  scheduleDailyBrief,
  scheduleReminders,
  setupReminderActions,
  SNOOZE_MINUTES,
  snoozeLocally,
} from './notifications';
import { registerForPush } from './push';
import { keys, useDayPlan, useMe, useUpcomingReminders } from './queries';
import { useSession, useT } from './session-context';

type ReminderData = { path?: string; reminderId?: string; sourceType?: string; sourceId?: string };

/**
 * Acts on a tapped notification: a plain tap opens the related screen; Done completes a task (or
 * acknowledges an event/date reminder); Snooze asks the server to remind again, and falls back to
 * a local re-alert when the server cannot (offline, or not yet marked as sent).
 */
async function handleResponse(
  response: Notifications.NotificationResponse,
  queryClient: QueryClient,
) {
  const content = response.notification.request.content;
  const data = (content.data ?? {}) as ReminderData;
  const refresh = () =>
    Promise.all(
      [keys.reminders, keys.tasks, keys.events].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );

  if (response.actionIdentifier === ACTION_DONE && data.reminderId) {
    try {
      if (data.sourceType === 'task' && data.sourceId) await api.completeTask(data.sourceId);
      await api.acknowledgeReminder(data.reminderId, 'COMPLETED');
    } catch {
      // Still open the item so the user can finish it by hand.
      if (data.path) router.push(data.path as never);
    }
    await refresh();
    return;
  }
  if (response.actionIdentifier === ACTION_SNOOZE && data.reminderId) {
    try {
      await api.snoozeReminder(data.reminderId, SNOOZE_MINUTES);
      await refresh(); // the next sync schedules it again
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'http' && e.status === 404) return;
      await snoozeLocally(content, SNOOZE_MINUTES);
    }
    return;
  }
  if (typeof data.path === 'string' && data.path.startsWith('/')) router.push(data.path as never);
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
  const queryClient = useQueryClient();
  // The same response can arrive from both the launch hook and the listener: act once.
  const handled = useRef(new Set<string>());
  const onResponse = (response: Notifications.NotificationResponse) => {
    const id = `${response.notification.request.identifier}:${response.notification.date}:${response.actionIdentifier}`;
    if (handled.current.has(id)) return;
    handled.current.add(id);
    void handleResponse(response, queryClient);
  };
  const onResponseRef = useRef(onResponse);
  useEffect(() => {
    onResponseRef.current = onResponse;
  });

  useEffect(() => {
    void setupReminderActions(t).catch(() => undefined);
  }, [t]);

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
      .then(setPushActive)
      .catch(() => setPushActive(false)); // never an unhandled rejection; local alerts still work
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
    onResponseRef.current(last);
    void Notifications.clearLastNotificationResponseAsync();
  }, [last]);

  // Taps while the app is running or in the background.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      onResponseRef.current(r),
    );
    return () => sub.remove();
  }, []);
}
