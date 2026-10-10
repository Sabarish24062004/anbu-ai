import type { PreferencesDto, UserDto } from '@anbu/shared';
import type { User, UserPreference } from '../../generated/prisma/client';

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    timezone: user.timezone,
    language: user.language,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toPreferencesDto(pref: UserPreference): PreferencesDto {
  return {
    defaultReminderLeadMinutes: pref.defaultReminderLeadMinutes,
    workStartMinutes: pref.workStartMinutes,
    workEndMinutes: pref.workEndMinutes,
    workDays: pref.workDays,
    wakeMinutes: pref.wakeMinutes,
    sleepMinutes: pref.sleepMinutes,
    importantDateNotifyMinutes: pref.importantDateNotifyMinutes,
    voiceResponsesEnabled: pref.voiceResponsesEnabled,
  };
}
