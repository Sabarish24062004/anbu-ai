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
};

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

/**
 * A mutation that refreshes the listed caches when it succeeds. `beforeInvalidate` runs first;
 * deletes use it to leave the detail screen before its now-missing record is refetched.
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
      return Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}
