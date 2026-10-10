/*
 * The local-notification parts of expo-notifications, imported file by file.
 *
 * Importing the package root runs DevicePushTokenAutoRegistration.fx.js, which registers a push
 * token listener at load time; in Expo Go on Android (SDK 53+) that throws ("remote notifications
 * functionality ... was removed from Expo Go") and crashes the app on start. None of the modules
 * below load that file. Push-token code is loaded on demand in push.ts, outside Expo Go only.
 *
 * Import notifications from here, never from 'expo-notifications' (ESLint enforces this; type-only
 * imports from the package are fine).
 */
export { scheduleNotificationAsync } from 'expo-notifications/build/scheduleNotificationAsync';
export { cancelAllScheduledNotificationsAsync } from 'expo-notifications/build/cancelAllScheduledNotificationsAsync';
export { setNotificationChannelAsync } from 'expo-notifications/build/setNotificationChannelAsync';
export { setNotificationCategoryAsync } from 'expo-notifications/build/setNotificationCategoryAsync';
export { setNotificationHandler } from 'expo-notifications/build/NotificationsHandler';
export {
  getPermissionsAsync,
  requestPermissionsAsync,
} from 'expo-notifications/build/NotificationPermissions';
export {
  addNotificationResponseReceivedListener,
  clearLastNotificationResponseAsync,
  DEFAULT_ACTION_IDENTIFIER,
} from 'expo-notifications/build/NotificationsEmitter';
export { useLastNotificationResponse } from 'expo-notifications/build/useLastNotificationResponse';
export { SchedulableTriggerInputTypes } from 'expo-notifications/build/Notifications.types';
export { AndroidImportance } from 'expo-notifications/build/NotificationChannelManager.types';
export { IosAuthorizationStatus } from 'expo-notifications/build/NotificationPermissions.types';
export type {
  NotificationContent,
  NotificationPermissionsStatus,
  NotificationResponse,
} from 'expo-notifications';
