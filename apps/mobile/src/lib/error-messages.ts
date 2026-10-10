import type { ScheduleConflict } from '@anbu/shared';
import type { Strings } from '@/i18n/strings';
import { ApiError } from './api-error';

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
    case 'NO_SPEECH':
      return t.noSpeech;
    case 'RATE_LIMITED':
      return t.rateLimited;
    case 'WRONG_PASSWORD':
      return t.wrongPassword;
    case 'REGISTRATION_CLOSED':
      return t.registrationClosed;
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
