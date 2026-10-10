import { z } from 'zod';
import type { Language } from './constants';
import type { ScheduleConflict } from './events';

export const ASSISTANT_MAX_INPUT_CHARS = 2000;

export const sendAssistantMessageSchema = z.strictObject({
  /** Omit to start a new conversation. */
  conversationId: z.uuid().optional(),
  text: z.string().trim().min(1).max(ASSISTANT_MAX_INPUT_CHARS),
});
export type SendAssistantMessageInput = z.input<typeof sendAssistantMessageSchema>;

/** Voice messages are short commands; this bounds upload size and transcription cost. */
export const VOICE_MAX_SECONDS = 60;
export const VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const VOICE_MIME_TYPES = [
  'audio/m4a',
  'audio/mp4',
  'audio/aac',
  'audio/webm',
  'audio/wav',
] as const;

export const sendVoiceMessageSchema = z.strictObject({
  conversationId: z.uuid().optional(),
  /** Base64 of the recording. */
  audio: z
    .string()
    .min(100, 'recording is empty')
    .max(Math.ceil((VOICE_MAX_BYTES * 4) / 3) + 4, 'recording is too long')
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be base64'),
  mimeType: z.enum(VOICE_MIME_TYPES),
});
export type SendVoiceMessageInput = z.input<typeof sendVoiceMessageSchema>;

const TAMIL_RE = /[஀-௿]/;

// Common Tamil words as typed in Latin letters (Tanglish). Two or more marks a message as Tamil.
const TANGLISH_WORDS = new Set(
  (
    'naalai nalaiku naaliku naalaikku inniku innaiku indru ippo ippa nethu netru kaalai kalaila ' +
    'saayangaalam sayangalam maalai raathiri rathiri madhiyam mani manikku ku kku pannu pannunga ' +
    'pannanum pannuga sollu sollunga solla vendum venum vendam illa illai irukku iruku enna ennoda ' +
    'enaku enakku unaku namma amma appa anna akka thambi thangachi paati thatha poganum ponum ' +
    'varanum vaanga nu da di ma pa remind panna pannu nyabagam gnabagam niyabagapaduthu seri sari ' +
    'aamaa aama venaam kitta oda la ah'
  ).split(' '),
);

/**
 * Tamil if the text contains Tamil script or reads as Tanglish (Tamil in Latin letters);
 * otherwise English. Deterministic, so server-written messages always match the user.
 */
export function detectLanguage(text: string): Language {
  if (TAMIL_RE.test(text)) return 'ta';
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hits = words.filter((w) => TANGLISH_WORDS.has(w)).length;
  return hits >= 2 && hits / words.length >= 0.2 ? 'ta' : 'en';
}

export const ASSISTANT_ACTION_KINDS = [
  'event.created',
  'event.updated',
  'event.cancelled',
  'task.created',
  'task.completed',
  'task.rescheduled',
  'important_date.created',
  'memory.saved',
  'memory.forgotten',
] as const;
export type AssistantActionKind = (typeof ASSISTANT_ACTION_KINDS)[number];

/** Something the assistant actually changed, taken from the service result, not the model text. */
export interface AssistantActionDto {
  kind: AssistantActionKind;
  entityType: 'event' | 'task' | 'importantDate' | 'memory';
  entityId: string;
  title: string;
  /** Local start/due time with offset, or "YYYY-MM-DD" for dates. */
  when: string | null;
}

export interface PendingActionDto {
  id: string;
  kind: 'create_event' | 'update_event' | 'cancel_event';
  /** One-line description in the user's language, e.g. "Cancel “Dentist” on Fri 14 Mar, 10:00". */
  summary: string;
  conflicts: ScheduleConflict[];
  expiresAt: string;
}

export interface AssistantMessageDto {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  language: Language | null;
  actions: AssistantActionDto[];
  createdAt: string;
}

export interface AssistantReplyDto {
  conversationId: string;
  userMessage: AssistantMessageDto;
  reply: AssistantMessageDto;
  pendingAction: PendingActionDto | null;
}

export interface AssistantVoiceReplyDto extends AssistantReplyDto {
  /** What the server heard; also stored as the user message. */
  transcript: string;
}

export interface ConversationDto {
  id: string;
  messages: AssistantMessageDto[];
  pendingAction: PendingActionDto | null;
}

/** Result of confirming or declining a pending action from its card in the app. */
export interface PendingDecisionDto {
  conversationId: string;
  reply: AssistantMessageDto;
}
