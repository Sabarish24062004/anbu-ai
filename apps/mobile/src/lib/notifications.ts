import * as Notifications from './expo-notifications';
import { Platform } from 'react-native';
import type { DayPlanDto, Language, ReminderDto } from '@anbu/shared';
import type { Strings } from '@/i18n/strings';
import { briefBody, pathFor, reminderBody } from './reminder-text';

export { briefBody, pathFor, reminderBody };

const CHANNEL_ID = 'reminders';
/** Reminder notifications carry Done and Snooze buttons (same id in server push messages). */
export const REMINDER_CATEGORY = 'reminder';
export const ACTION_DONE = 'done';
export const ACTION_SNOOZE = 'snooze';
export const SNOOZE_MINUTES = 10;
const MAX_SCHEDULED = 60; // iOS keeps at most 64 pending local notifications per app
const MIN_LEAD_MS = 5_000;

// Show reminders even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PermissionState = 'granted' | 'denied' | 'undetermined';

async function ensureChannel() {
  // Android needs a channel before it can ask for permission or show anything.
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
}

function toState(status: Notifications.NotificationPermissionsStatus): PermissionState {
  if (status.granted) return 'granted';
  if (status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  return status.canAskAgain ? 'undetermined' : 'denied';
}

/**
 * Registers the Done / Snooze buttons in the user's language. Both open the app: with the app
 * closed, a button that does not open it never reaches the app (an Expo Notifications limit).
 */
export async function setupReminderActions(t: Strings) {
  if (Platform.OS === 'web') return;
  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
    { identifier: ACTION_DONE, buttonTitle: t.notifDone, options: { opensAppToForeground: true } },
    {
      identifier: ACTION_SNOOZE,
      buttonTitle: t.snooze(SNOOZE_MINUTES),
      options: { opensAppToForeground: true },
    },
  ]);
}

/** Shows the same reminder again in a few minutes, on this phone only (works offline). */
export async function snoozeLocally(content: Notifications.NotificationContent, minutes: number) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      data: content.data,
      sound: true,
      categoryIdentifier: REMINDER_CATEGORY,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(Date.now() + minutes * 60_000),
      channelId: CHANNEL_ID,
    },
  });
}

export async function getPermission(): Promise<PermissionState> {
  if (Platform.OS === 'web') return 'denied';
  await ensureChannel();
  return toState(await Notifications.getPermissionsAsync());
}

export async function requestPermission(): Promise<PermissionState> {
  if (Platform.OS === 'web') return 'denied';
  await ensureChannel();
  return toState(await Notifications.requestPermissionsAsync());
}

/**
 * Replaces the phone's scheduled notifications with the server's upcoming reminders. The server
 * is the source of truth, so a full replace keeps edits, cancellations and snoozes in step.
 */
export async function scheduleReminders(reminders: ReminderDto[], t: Strings, lang: Language) {
  if (Platform.OS === 'web') return;
  await ensureChannel();
  await Notifications.cancelAllScheduledNotificationsAsync();
  const soonest = reminders
    .filter((r) => Date.parse(r.triggerAt) > Date.now() + MIN_LEAD_MS)
    .slice(0, MAX_SCHEDULED);
  for (const r of soonest) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: {
        title: r.source.title,
        body: reminderBody(r, t, lang),
        data: {
          path: pathFor(r),
          reminderId: r.id,
          sourceType: r.source.type,
          sourceId: r.source.id,
        },
        sound: true,
        categoryIdentifier: REMINDER_CATEGORY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(r.triggerAt),
        channelId: CHANNEL_ID,
      },
    });
  }
}

const BRIEF_ID = 'daily-brief';

/**
 * Schedules the morning brief for `at` with the plan for that day. Call after scheduleReminders,
 * which clears every scheduled notification first.
 */
export async function scheduleDailyBrief(at: Date, plan: DayPlanDto, t: Strings, lang: Language) {
  if (Platform.OS === 'web' || at.getTime() <= Date.now() + MIN_LEAD_MS) return;
  await Notifications.scheduleNotificationAsync({
    identifier: BRIEF_ID,
    content: {
      title: t.briefTitle,
      body: briefBody(plan, t, lang),
      data: { path: '/plan' },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: CHANNEL_ID,
    },
  });
}

export async function clearScheduledReminders() {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
