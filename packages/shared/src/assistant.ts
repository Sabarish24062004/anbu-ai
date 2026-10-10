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

const TAMIL_RE = /[஀-௿]/;

/** Tamil if the text contains any Tamil script; Tanglish and English are treated as English. */
export function detectLanguage(text: string): Language {
  return TAMIL_RE.test(text) ? 'ta' : 'en';
}

export const ASSISTANT_ACTION_KINDS = [
  'event.created',
  'event.updated',
  'event.cancelled',
  'task.created',
  'task.completed',
  'task.rescheduled',
  'important_date.created',
] as const;
export type AssistantActionKind = (typeof ASSISTANT_ACTION_KINDS)[number];

/** Something the assistant actually changed, taken from the service result, not the model text. */
export interface AssistantActionDto {
  kind: AssistantActionKind;
  entityType: 'event' | 'task' | 'importantDate';
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
