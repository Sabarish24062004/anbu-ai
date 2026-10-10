import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { addDays, startOfToday, toLocalDateString } from './datetime';
import { sessionStore } from './session';

export const AGENDA_DAYS = 7;

export const keys = {
  me: ['me'] as const,
  events: ['events'] as const,
  event: (id: string) => ['events', 'detail', id] as const,
  tasks: ['tasks'] as const,
  task: (id: string) => ['tasks', 'detail', id] as const,
  dates: ['important-dates'] as const,
  date: (id: string) => ['important-dates', 'detail', id] as const,
  reminders: ['reminders'] as const,
};

// How far ahead the phone schedules local notifications. iOS keeps at most 64 pending.
export const NOTIFICATION_WINDOW_HOURS = 72;
const REMINDER_REFRESH_MS = 15 * 60_000;

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      const me = await api.me();
      await sessionStore.setUser(me.user); // keeps the UI language in sync with the server
      return me;
    },
  });
}

export function useAgenda() {
  const from = startOfToday();
  const fromKey = toLocalDateString(from);
  const toKey = toLocalDateString(addDays(from, AGENDA_DAYS));
  return useQuery({
    queryKey: [...keys.events, 'range', fromKey, toKey],
    queryFn: () => api.occurrences(fromKey, toKey),
  });
}

export function useEvent(id: string) {
  return useQuery({ queryKey: keys.event(id), queryFn: () => api.event(id) });
}

export function useTasks() {
  return useQuery({ queryKey: keys.tasks, queryFn: api.tasks });
}

export function useTask(id: string) {
  return useQuery({ queryKey: keys.task(id), queryFn: () => api.task(id) });
}

export function useUpcomingDates(days: number) {
  return useQuery({
    queryKey: [...keys.dates, 'upcoming', days],
    queryFn: () => api.upcomingDates(days),
  });
}

export function useImportantDate(id: string) {
  return useQuery({ queryKey: keys.date(id), queryFn: () => api.importantDate(id) });
}

export function useUpcomingReminders() {
  return useQuery({
    queryKey: [...keys.reminders, 'upcoming'],
    queryFn: () => api.upcomingReminders(NOTIFICATION_WINDOW_HOURS),
    refetchInterval: REMINDER_REFRESH_MS,
  });
}

export function useDueReminders() {
  return useQuery({
    queryKey: [...keys.reminders, 'due'],
    queryFn: api.dueReminders,
    refetchInterval: 60_000,
  });
}

/**
 * A mutation that refreshes the listed caches, and reminders (any change can move them), when it
 * succeeds. `beforeInvalidate` runs first; deletes use it to leave the detail screen before its
 * now-missing record is refetched.
 */
export function useInvalidatingMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidate: readonly (readonly string[])[],
  beforeInvalidate?: (result: TResult) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      beforeInvalidate?.(result);
      return Promise.all(
        [...invalidate, keys.reminders].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}
