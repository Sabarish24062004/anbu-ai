import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Language, ReminderDto } from '@anbu/shared';
import type { Strings } from '@/i18n/strings';
import { formatTime } from './datetime';

const CHANNEL_ID = 'reminders';
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

/** The app route a reminder opens when tapped. */
export function pathFor(r: ReminderDto): string {
  switch (r.source.type) {
    case 'event':
      return `/event/${r.source.id}`;
    case 'task':
      return `/task/${r.source.id}`;
    case 'importantDate':
      return `/date/${r.source.id}`;
  }
}

export function reminderBody(r: ReminderDto, t: Strings, lang: Language): string {
  switch (r.source.type) {
    case 'event':
      if (r.source.dateOnly) return t.reminderDateBody(Math.round(r.offsetMinutes / 1440));
      return r.offsetMinutes === 0
        ? t.reminderEventNow
        : t.reminderEventBody(formatTime(r.occurrenceAt, lang));
    case 'task':
      return t.reminderTaskBody(formatTime(r.occurrenceAt, lang));
    case 'importantDate':
      return t.reminderDateBody(Math.round(r.offsetMinutes / 1440));
  }
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
        data: { path: pathFor(r), reminderId: r.id },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(r.triggerAt),
        channelId: CHANNEL_ID,
      },
    });
  }
}

export async function clearScheduledReminders() {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
