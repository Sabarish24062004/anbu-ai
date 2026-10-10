import { DateTime } from 'luxon';
import type { AssistantActionDto, Language } from '@anbu/shared';

/*
 * Fixed, localised sentences the server writes itself: confirmations of pending actions and the
 * fallback reply when the model fails after changes were already made. They describe what the
 * database says happened, so they are always truthful even when the model is unavailable.
 */

const locale = (lang: Language) => (lang === 'ta' ? 'ta-IN' : 'en-IN');

/** "Fri, 14 Mar, 10:00 am" (or just the date) in the item's own offset. */
export function formatWhen(when: string | null, lang: Language): string {
  if (!when) return '';
  const dt = DateTime.fromISO(when, { setZone: true });
  if (!dt.isValid) return when;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(when);
  return dt
    .setLocale(locale(lang))
    .toLocaleString(
      dateOnly
        ? { weekday: 'short', day: 'numeric', month: 'short' }
        : { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' },
    );
}

const T = {
  en: {
    'event.created': (t: string, w: string) => `Added “${t}”${w ? ` on ${w}` : ''}.`,
    'event.updated': (t: string, w: string) => `Updated “${t}”${w ? ` — now ${w}` : ''}.`,
    'event.cancelled': (t: string) => `Cancelled “${t}”.`,
    'event.occurrence_skipped': (t: string, w: string) => `Skipped “${t}” on ${w}.`,
    'event.occurrence_moved': (t: string, w: string) => `Moved this “${t}” to ${w}.`,
    confirmMoveOccurrence: (t: string, w: string) =>
      `Move this “${t}” to ${w} even though it overlaps`,
    'task.created': (t: string, w: string) => `Added the task “${t}”${w ? `, due ${w}` : ''}.`,
    'task.completed': (t: string) => `Marked “${t}” as done.`,
    'task.rescheduled': (t: string, w: string) => `Done! “${t}” is next due ${w}.`,
    'important_date.created': (t: string, w: string) => `Saved “${t}”${w ? ` (${w})` : ''}.`,
    'memory.saved': (t: string) => `I’ll remember: ${t}.`,
    'memory.forgotten': (t: string) => `Forgotten: ${t}.`,
    confirmCreate: (t: string, w: string) => `Add “${t}” on ${w} even though it overlaps`,
    confirmUpdate: (t: string, w: string) => `Move “${t}” to ${w} even though it overlaps`,
    confirmCancel: (t: string, w: string) => `Cancel “${t}”${w ? ` on ${w}` : ''}`,
    declined: 'Okay, I left it as it was.',
    expired: 'That request has expired. Please ask again.',
    failedAfterActions: 'I could not finish the reply, but this is what I did:',
    nothingDone: 'Sorry, I could not do that right now. Nothing was changed.',
  },
  ta: {
    'event.created': (t: string, w: string) => `“${t}” சேர்க்கப்பட்டது${w ? ` — ${w}` : ''}.`,
    'event.updated': (t: string, w: string) => `“${t}” மாற்றப்பட்டது${w ? ` — இப்போது ${w}` : ''}.`,
    'event.cancelled': (t: string) => `“${t}” ரத்து செய்யப்பட்டது.`,
    'event.occurrence_skipped': (t: string, w: string) => `${w} அன்று “${t}” தவிர்க்கப்பட்டது.`,
    'event.occurrence_moved': (t: string, w: string) => `இந்த “${t}” ${w} க்கு மாற்றப்பட்டது.`,
    confirmMoveOccurrence: (t: string, w: string) =>
      `நேரம் மோதினாலும் இந்த “${t}” ஐ ${w} க்கு மாற்றவா`,
    'task.created': (t: string, w: string) =>
      `“${t}” பணி சேர்க்கப்பட்டது${w ? ` — கெடு ${w}` : ''}.`,
    'task.completed': (t: string) => `“${t}” முடிந்ததாகக் குறிக்கப்பட்டது.`,
    'task.rescheduled': (t: string, w: string) => `முடிந்தது! “${t}” அடுத்த கெடு ${w}.`,
    'important_date.created': (t: string, w: string) =>
      `“${t}” சேமிக்கப்பட்டது${w ? ` (${w})` : ''}.`,
    'memory.saved': (t: string) => `நினைவில் வைத்துக்கொண்டேன்: ${t}.`,
    'memory.forgotten': (t: string) => `மறந்துவிட்டேன்: ${t}.`,
    confirmCreate: (t: string, w: string) => `நேரம் மோதினாலும் “${t}” ஐ ${w} அன்று சேர்க்கவா`,
    confirmUpdate: (t: string, w: string) => `நேரம் மோதினாலும் “${t}” ஐ ${w} க்கு மாற்றவா`,
    confirmCancel: (t: string, w: string) => `“${t}”${w ? ` (${w})` : ''} ஐ ரத்து செய்யவா`,
    declined: 'சரி, எதையும் மாற்றவில்லை.',
    expired: 'அந்தக் கோரிக்கை காலாவதியாகிவிட்டது. மீண்டும் கேளுங்கள்.',
    failedAfterActions: 'பதிலை முடிக்க முடியவில்லை, ஆனால் நான் செய்தவை:',
    nothingDone: 'மன்னிக்கவும், இப்போது அதைச் செய்ய முடியவில்லை. எதுவும் மாற்றப்படவில்லை.',
  },
};

export const messages = (lang: Language) => T[lang];

export function describeAction(a: AssistantActionDto, lang: Language): string {
  return T[lang][a.kind](a.title, formatWhen(a.when, lang));
}

/** The reply used when the model cannot produce one: a plain account of what changed. */
export function fallbackReply(actions: AssistantActionDto[], lang: Language): string {
  if (!actions.length) return T[lang].nothingDone;
  return [T[lang].failedAfterActions, ...actions.map((a) => `• ${describeAction(a, lang)}`)].join(
    '\n',
  );
}
