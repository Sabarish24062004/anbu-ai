export const DEFAULT_APP_NAME = 'Anbu AI';
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export const SUPPORTED_LANGUAGES = ['ta', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'ta';

export const REMINDER_LEAD_OPTIONS_MINUTES = [10, 15, 30, 60] as const;
export const DEFAULT_REMINDER_LEAD_MINUTES = 15;
