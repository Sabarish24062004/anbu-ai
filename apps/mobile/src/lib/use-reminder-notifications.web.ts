/**
 * Web version of use-reminder-notifications.ts (Metro picks this file on web). Browsers get no
 * phone notifications, and expo-notifications' launch-response hook throws there, so this does
 * nothing; due reminders still appear in the Agenda's "Due now" list.
 */
export function useReminderNotifications() {}
