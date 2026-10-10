import { Alert, Platform } from 'react-native';
import type { ScheduleConflict } from '@anbu/shared';
import type { Strings } from '@/i18n/strings';
import { ApiError } from './http';

/** A user-facing message for any error from the API client. */
export function errorMessage(err: unknown, t: Strings): string {
  if (!(err instanceof ApiError)) return t.errorGeneric;
  if (err.kind === 'network' || err.kind === 'timeout') return t.errorNetwork;
  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      return t.errorInvalidCredentials;
    case 'EMAIL_TAKEN':
      return t.errorEmailTaken;
    case 'TASK_BLOCKED':
      return t.errorTaskBlocked;
    case 'VALIDATION_ERROR':
      return t.errorValidation;
    case 'ASSISTANT_UNAVAILABLE':
      return t.assistantUnavailable;
    case 'ASSISTANT_BUSY':
      return t.assistantBusy;
    default:
      return t.errorGeneric;
  }
}

/** Field-level messages from a 400 VALIDATION_ERROR, keyed by field path. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return {};
  const details = Array.isArray(err.details) ? err.details : [];
  const out: Record<string, string> = {};
  for (const d of details as { path?: string; message?: string }[]) {
    if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
  }
  return out;
}

export function scheduleConflicts(err: unknown): ScheduleConflict[] | null {
  if (!(err instanceof ApiError) || err.code !== 'SCHEDULE_CONFLICT') return null;
  return (err.details as { conflicts?: ScheduleConflict[] } | undefined)?.conflicts ?? [];
}

/** Two-button confirmation that also works on Expo web, where Alert buttons are unsupported. */
export function confirm(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
}): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(globalThis.confirm?.(`${opts.title}\n\n${opts.message}`) ?? false);
  }
  return new Promise((resolve) => {
    Alert.alert(
      opts.title,
      opts.message,
      [
        { text: opts.cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        {
          text: opts.confirmLabel,
          style: opts.destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
