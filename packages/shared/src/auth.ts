import { z } from 'zod';
import { SUPPORTED_LANGUAGES, type Language } from './constants';
import { timezoneSchema } from './validation';

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
// Upper bound keeps hashing cost bounded; no composition rules (NIST SP 800-63B).
export const passwordSchema = z.string().min(8, 'must be at least 8 characters').max(128);
export const languageSchema = z.enum(SUPPORTED_LANGUAGES);

export const registerSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100).optional(),
  timezone: timezoneSchema.optional(),
  language: languageSchema.optional(),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const deleteAccountSchema = z.strictObject({ password: z.string().min(1).max(128) });

export const refreshSchema = z.strictObject({ refreshToken: z.string().min(1).max(200) });

export const updateMeSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(100).nullable(),
    timezone: timezoneSchema,
    language: languageSchema,
  })
  .partial();
export type UpdateMeInput = z.input<typeof updateMeSchema>;

const minuteOfDay = z
  .number()
  .int()
  .min(0)
  .max(24 * 60 - 1);

export const updatePreferencesSchema = z
  .strictObject({
    defaultReminderLeadMinutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
    workStartMinutes: minuteOfDay.nullable(),
    workEndMinutes: minuteOfDay.nullable(),
    workDays: z
      .array(z.number().int().min(1).max(7))
      .max(7)
      .transform((d) => [...new Set(d)].sort()),
    wakeMinutes: minuteOfDay.nullable(),
    sleepMinutes: minuteOfDay.nullable(),
    importantDateNotifyMinutes: minuteOfDay,
    voiceResponsesEnabled: z.boolean(),
    dailyBriefEnabled: z.boolean(),
  })
  .partial();
export type UpdatePreferencesInput = z.input<typeof updatePreferencesSchema>;

export interface UserDto {
  id: string;
  email: string;
  displayName: string | null;
  timezone: string;
  language: Language;
  createdAt: string;
}

export interface PreferencesDto {
  defaultReminderLeadMinutes: number;
  workStartMinutes: number | null;
  workEndMinutes: number | null;
  workDays: number[];
  wakeMinutes: number | null;
  sleepMinutes: number | null;
  importantDateNotifyMinutes: number;
  voiceResponsesEnabled: boolean;
  dailyBriefEnabled: boolean;
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface AuthResponse {
  user: UserDto;
  tokens: AuthTokens;
}

export interface MeResponse {
  user: UserDto;
  preferences: PreferencesDto;
}
