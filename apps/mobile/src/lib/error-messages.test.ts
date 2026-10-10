import { describe, expect, it } from 'vitest';
import { STRINGS } from '@/i18n/strings';
import { ApiError } from './api-error';
import { errorMessage, fieldErrors, scheduleConflicts } from './error-messages';

const t = STRINGS.en;

describe('error messages', () => {
  it('explains network problems and known API errors', () => {
    expect(errorMessage(new ApiError('x', 'network'), t)).toBe(t.errorNetwork);
    expect(errorMessage(new ApiError('x', 'timeout'), t)).toBe(t.errorNetwork);
    const codes: [string, string][] = [
      ['INVALID_CREDENTIALS', t.errorInvalidCredentials],
      ['RATE_LIMITED', t.rateLimited],
      ['ASSISTANT_BUSY', t.assistantBusy],
      ['NO_SPEECH', t.noSpeech],
      ['WRONG_PASSWORD', t.wrongPassword],
      ['REGISTRATION_CLOSED', t.registrationClosed],
    ];
    for (const [code, message] of codes) {
      expect(errorMessage(new ApiError('x', 'http', 400, code), t)).toBe(message);
    }
  });

  it('never shows raw server text for unknown errors', () => {
    expect(errorMessage(new ApiError('SQL details', 'http', 500, 'INTERNAL'), t)).toBe(
      t.errorGeneric,
    );
    expect(errorMessage(new Error('boom'), t)).toBe(t.errorGeneric);
  });

  it('maps validation details to fields, first message per field', () => {
    const err = new ApiError('x', 'http', 400, 'VALIDATION_ERROR', [
      { path: 'title', message: 'Required' },
      { path: 'title', message: 'Too long' },
      { path: 'endAt', message: 'must not be before startAt' },
    ]);
    expect(fieldErrors(err)).toEqual({ title: 'Required', endAt: 'must not be before startAt' });
    expect(fieldErrors(new ApiError('x', 'network'))).toEqual({});
  });

  it('extracts schedule conflicts only from SCHEDULE_CONFLICT', () => {
    const conflict = { eventId: 'e', title: 'Doctor' };
    const err = new ApiError('x', 'http', 409, 'SCHEDULE_CONFLICT', { conflicts: [conflict] });
    expect(scheduleConflicts(err)).toEqual([conflict]);
    expect(scheduleConflicts(new ApiError('x', 'http', 409, 'INVALID_STATE'))).toBeNull();
  });
});

describe('translations', () => {
  it('has every English string in Tamil, none empty', () => {
    expect(Object.keys(STRINGS.ta).sort()).toEqual(Object.keys(STRINGS.en).sort());
    for (const lang of ['en', 'ta'] as const) {
      for (const [key, value] of Object.entries(STRINGS[lang])) {
        const text =
          typeof value === 'function' ? (value as (...a: unknown[]) => string)(2, 'x') : value;
        expect(text, `${lang}.${key}`).toMatch(/\S/);
      }
    }
  });
});
