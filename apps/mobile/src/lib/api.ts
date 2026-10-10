import {
  healthResponseSchema,
  type AssistantReplyDto,
  type AssistantVoiceReplyDto,
  type ConversationDto,
  type PendingDecisionDto,
  type AuthResponse,
  type CompleteTaskResponse,
  type CreateEventInput,
  type CreateImportantDateInput,
  type CreateTaskInput,
  type DayPlanDto,
  type MemoryDto,
  type EventDto,
  type EventMutationResponse,
  type EventOccurrenceDto,
  type HealthResponse,
  type ImportantDateDto,
  type LoginInput,
  type MeResponse,
  type RegisterInput,
  type ReminderDto,
  type TaskDto,
  type UpcomingImportantDateDto,
  type UpdateEventInput,
  type UpdateImportantDateInput,
  type UpdateMeInput,
  type UpdatePreferencesInput,
  type UpdateTaskInput,
} from '@anbu/shared';
import { ApiError, sendJson, toApiError } from './http';
import { sessionStore } from './session';

export { ApiError } from './http';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Lets the server apply a retried mutation once (see the API's idempotency middleware). */
  idempotencyKey?: string;
  timeoutMs?: number;
}

// An assistant turn can take several model calls, plus transcription for voice.
const ASSISTANT_TIMEOUT_MS = 60_000;

const signedOut = () => new ApiError('Sign in required', 'http', 401, 'UNAUTHORIZED');

/** Authenticated request: attaches the access token and retries once after a refresh on 401. */
async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const qs = Object.entries(opts.query ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = qs ? `${path}?${qs}` : path;
  const send = (token: string) =>
    sendJson(url, {
      method: opts.method,
      body: opts.body,
      timeoutMs: opts.timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
    });

  const token = await sessionStore.getAccessToken();
  if (!token) throw signedOut();
  let res = await send(token);
  if (res.status === 401) {
    const fresh = await sessionStore.refreshAccessToken();
    if (!fresh) throw signedOut();
    res = await send(fresh);
  }
  if (res.status < 200 || res.status >= 300) throw toApiError(res);
  return res.body as T;
}

async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await sendJson(path, { method: 'POST', body });
  if (res.status < 200 || res.status >= 300) throw toApiError(res);
  return res.body as T;
}

/** /health returns 503 with a valid body when degraded, so both 200 and 503 are parsed. */
export async function fetchHealth(): Promise<HealthResponse> {
  const { status, body } = await sendJson('/health');
  if (status !== 200 && status !== 503) throw new ApiError(`HTTP ${status}`, 'http', status);
  const parsed = healthResponseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError('Unexpected response from server', 'invalid_response');
  return parsed.data;
}

export const api = {
  register: (input: RegisterInput) => publicPost<AuthResponse>('/auth/register', input),
  login: (input: LoginInput) => publicPost<AuthResponse>('/auth/login', input),

  me: () => request<MeResponse>('/me'),
  updateMe: (input: UpdateMeInput) => request<MeResponse>('/me', { method: 'PATCH', body: input }),
  updatePreferences: (input: UpdatePreferencesInput) =>
    request<MeResponse>('/me/preferences', { method: 'PATCH', body: input }),

  occurrences: (from: string, to: string) =>
    request<{ from: string; to: string; occurrences: EventOccurrenceDto[] }>('/events', {
      query: { from, to },
    }),
  event: (id: string) => request<{ event: EventDto }>(`/events/${id}`),
  createEvent: (input: CreateEventInput, idempotencyKey?: string) =>
    request<EventMutationResponse>('/events', { method: 'POST', body: input, idempotencyKey }),
  updateEvent: (id: string, input: UpdateEventInput, idempotencyKey?: string) =>
    request<EventMutationResponse>(`/events/${id}`, {
      method: 'PATCH',
      body: input,
      idempotencyKey,
    }),
  cancelEvent: (id: string) =>
    request<{ event: EventDto }>(`/events/${id}/cancel`, { method: 'POST' }),
  completeEvent: (id: string) =>
    request<{ event: EventDto }>(`/events/${id}/complete`, { method: 'POST' }),
  deleteEvent: (id: string) => request<void>(`/events/${id}`, { method: 'DELETE' }),

  tasks: () => request<{ tasks: TaskDto[] }>('/tasks'),
  task: (id: string) => request<{ task: TaskDto }>(`/tasks/${id}`),
  createTask: (input: CreateTaskInput, idempotencyKey?: string) =>
    request<{ task: TaskDto }>('/tasks', { method: 'POST', body: input, idempotencyKey }),
  updateTask: (id: string, input: UpdateTaskInput, idempotencyKey?: string) =>
    request<{ task: TaskDto }>(`/tasks/${id}`, { method: 'PATCH', body: input, idempotencyKey }),
  completeTask: (id: string) =>
    request<CompleteTaskResponse>(`/tasks/${id}/complete`, { method: 'POST' }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),

  upcomingDates: (days: number) =>
    request<{ upcoming: UpcomingImportantDateDto[] }>('/important-dates/upcoming', {
      query: { days },
    }),
  importantDate: (id: string) =>
    request<{ importantDate: ImportantDateDto }>(`/important-dates/${id}`),
  createImportantDate: (input: CreateImportantDateInput, idempotencyKey?: string) =>
    request<{ importantDate: ImportantDateDto }>('/important-dates', {
      method: 'POST',
      body: input,
      idempotencyKey,
    }),
  updateImportantDate: (id: string, input: UpdateImportantDateInput, idempotencyKey?: string) =>
    request<{ importantDate: ImportantDateDto }>(`/important-dates/${id}`, {
      method: 'PATCH',
      body: input,
      idempotencyKey,
    }),
  deleteImportantDate: (id: string) =>
    request<void>(`/important-dates/${id}`, { method: 'DELETE' }),

  assistantStatus: () => request<{ available: boolean; voice: boolean }>('/assistant/status'),
  sendVoiceMessage: (
    input: { conversationId?: string; audio: string; mimeType: string },
    idempotencyKey?: string,
  ) =>
    request<AssistantVoiceReplyDto>('/assistant/voice', {
      method: 'POST',
      body: input,
      idempotencyKey,
      timeoutMs: ASSISTANT_TIMEOUT_MS,
    }),
  latestConversation: () =>
    request<{ conversation: ConversationDto | null }>('/assistant/conversations/latest'),
  sendAssistantMessage: (
    input: { conversationId?: string; text: string },
    idempotencyKey?: string,
  ) =>
    request<AssistantReplyDto>('/assistant/messages', {
      method: 'POST',
      body: input,
      idempotencyKey,
      timeoutMs: ASSISTANT_TIMEOUT_MS,
    }),
  decidePending: (conversationId: string, pendingId: string, decision: 'confirm' | 'decline') =>
    request<PendingDecisionDto>(
      `/assistant/conversations/${conversationId}/pending/${pendingId}/${decision}`,
      { method: 'POST' },
    ),

  dayPlan: (date: string) => request<{ plan: DayPlanDto }>('/planning/day', { query: { date } }),
  memories: () => request<{ memories: MemoryDto[] }>('/memories'),
  deleteMemory: (id: string) => request<void>(`/memories/${id}`, { method: 'DELETE' }),
  deleteAllMemories: () => request<{ deleted: number }>('/memories', { method: 'DELETE' }),

  upcomingReminders: (hours: number) =>
    request<{ reminders: ReminderDto[] }>('/reminders/upcoming', { query: { hours } }),
  dueReminders: () => request<{ reminders: ReminderDto[] }>('/reminders/due'),
  acknowledgeReminder: (id: string, action: 'COMPLETED' | 'DISMISSED') =>
    request<{ reminder: ReminderDto }>(`/reminders/${id}/acknowledge`, {
      method: 'POST',
      body: { action },
    }),
  snoozeReminder: (id: string, minutes: number) =>
    request<{ reminder: ReminderDto }>(`/reminders/${id}/snooze`, {
      method: 'POST',
      body: { minutes },
    }),
};
