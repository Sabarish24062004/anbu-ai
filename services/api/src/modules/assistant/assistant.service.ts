import { DateTime } from 'luxon';
import type { Logger } from 'pino';
import {
  detectLanguage,
  type AssistantActionDto,
  type AssistantMessageDto,
  type AssistantReplyDto,
  type ConversationDto,
  type Language,
  type PendingActionDto,
  type PendingDecisionDto,
  type ScheduleConflict,
} from '@anbu/shared';
import { audit } from '../../common/audit';
import { AppError, notFound } from '../../common/errors';
import type { PrismaClient } from '../../database/prisma';
import type { ConversationMessage, Prisma } from '../../generated/prisma/client';
import { cancelEvent, createEvent, updateEvent } from '../events/events.service';
import { getActiveUser } from '../users/users.service';
import { LlmError, type ChatTurn, type LlmProvider, type ToolResult } from './llm/types';
import { describeAction, fallbackReply, messages } from './messages';
import { buildSystemPrompt } from './prompt';
import {
  PENDING_TOOL_SPECS,
  runTool,
  TOOL_SPECS,
  type PendingSpec,
  type ToolContext,
} from './tools';

const HISTORY_MESSAGES = 12;
const MAX_MODEL_CALLS = 6;
const MAX_TOOL_CALLS_PER_STEP = 8;
const PENDING_TTL_MS = 30 * 60_000;
const PENDING_TOOL = 'pending_action';

export interface AssistantDeps {
  prisma: PrismaClient;
  llm: LlmProvider | null;
  logger: Logger;
  appName: string;
}

interface PendingPayload {
  status: 'pending' | 'confirmed' | 'declined' | 'superseded';
  spec: PendingSpec;
  summary: string;
  conflicts: ScheduleConflict[];
  language: Language;
  expiresAt: string;
}

interface MessagePayload {
  actions?: AssistantActionDto[];
}

// ---------------------------------------------------------------------------------------------
// Mapping

function toMessageDto(m: ConversationMessage): AssistantMessageDto {
  const payload = (m.toolPayload ?? {}) as MessagePayload;
  return {
    id: m.id,
    role: m.role === 'USER' ? 'user' : 'assistant',
    text: m.content,
    language: m.language,
    actions: payload.actions ?? [],
    createdAt: m.createdAt.toISOString(),
  };
}

function toPendingDto(m: ConversationMessage): PendingActionDto {
  const p = m.toolPayload as unknown as PendingPayload;
  return {
    id: m.id,
    kind: p.spec.kind,
    summary: p.summary,
    conflicts: p.conflicts,
    expiresAt: p.expiresAt,
  };
}

// ---------------------------------------------------------------------------------------------
// Conversations and pending actions

async function findConversation(prisma: PrismaClient, userId: string, id: string) {
  const conversation = await prisma.conversation.findFirst({ where: { id, userId } });
  if (!conversation) throw notFound('Conversation');
  return conversation;
}

async function activePending(prisma: PrismaClient, conversationId: string, now = new Date()) {
  const row = await prisma.conversationMessage.findFirst({
    where: { conversationId, role: 'TOOL', toolName: PENDING_TOOL },
    orderBy: { createdAt: 'desc' },
  });
  const payload = row?.toolPayload as unknown as PendingPayload | undefined;
  if (!row || payload?.status !== 'pending' || Date.parse(payload.expiresAt) <= now.getTime()) {
    return null;
  }
  return { row, payload };
}

async function setPendingStatus(
  db: PrismaClient | Prisma.TransactionClient,
  row: ConversationMessage,
  status: PendingPayload['status'],
) {
  const payload = { ...(row.toolPayload as unknown as PendingPayload), status };
  await db.conversationMessage.update({
    where: { id: row.id },
    data: { toolPayload: payload as unknown as Prisma.InputJsonValue },
  });
}

/** Applies a confirmed action through the normal services (so reminders, audit etc. follow). */
async function executePending(
  prisma: PrismaClient,
  userId: string,
  spec: PendingSpec,
): Promise<AssistantActionDto> {
  switch (spec.kind) {
    case 'create_event': {
      const { event } = await createEvent(prisma, userId, { ...spec.input, allowConflicts: true });
      return eventAction('event.created', event);
    }
    case 'update_event': {
      const { event } = await updateEvent(prisma, userId, spec.eventId, {
        ...spec.input,
        allowConflicts: true,
      });
      return eventAction('event.updated', event);
    }
    case 'cancel_event': {
      const event = await cancelEvent(prisma, userId, spec.eventId);
      return { ...eventAction('event.updated', event), kind: 'event.cancelled', when: null };
    }
  }
}

function eventAction(
  kind: 'event.created' | 'event.updated',
  e: { id: string; title: string; startAt: string; allDay: boolean },
): AssistantActionDto {
  return {
    kind,
    entityType: 'event',
    entityId: e.id,
    title: e.title,
    when: e.allDay ? e.startAt.slice(0, 10) : e.startAt,
  };
}

// ---------------------------------------------------------------------------------------------
// The assistant turn

type ToolRecord = { name: string; args: unknown; result: unknown; isError: boolean };

/**
 * Handles one user message: runs the model ↔ tool loop, then stores the user message, the tool
 * calls, any new pending confirmation and the reply in one transaction. If the model fails after
 * tools already changed something, the reply falls back to a plain account of those changes; if it
 * fails before doing anything, nothing is stored and the caller gets 503.
 */
export async function handleMessage(
  deps: AssistantDeps,
  userId: string,
  input: { conversationId?: string; text: string },
): Promise<AssistantReplyDto> {
  const { prisma, llm, logger } = deps;
  if (!llm) {
    throw new AppError(
      503,
      'ASSISTANT_UNAVAILABLE',
      'The assistant is not configured on the server',
    );
  }
  const user = await getActiveUser(prisma, userId);
  const conversation = input.conversationId
    ? await findConversation(prisma, userId, input.conversationId)
    : null;
  const language = detectLanguage(input.text);
  const now = new Date();

  const historyRows = conversation
    ? await prisma.conversationMessage.findMany({
        where: { conversationId: conversation.id, role: { in: ['USER', 'ASSISTANT'] } },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_MESSAGES,
      })
    : [];
  const history: ChatTurn[] = historyRows
    .reverse()
    .map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant', text: m.content }));
  let pending = conversation ? await activePending(prisma, conversation.id, now) : null;

  const ctx: ToolContext = { prisma, userId, timezone: user.timezone, language };
  const session = llm.startTurn({
    system: buildSystemPrompt({
      appName: deps.appName,
      displayName: user.displayName,
      timezone: user.timezone,
      preferredLanguage: user.language,
      now: DateTime.fromJSDate(now),
      pendingSummary: pending?.payload.summary ?? null,
    }),
    history,
    userText: input.text,
    tools: pending ? [...TOOL_SPECS, ...PENDING_TOOL_SPECS] : TOOL_SPECS,
  });

  const actions: AssistantActionDto[] = [];
  const toolRecords: ToolRecord[] = [];
  let newPending: Omit<PendingPayload, 'status' | 'expiresAt' | 'language'> | null = null;
  let replyText: string | null = null;
  let modelFailed = false;

  try {
    let results: ToolResult[] | undefined;
    for (let call = 0; call < MAX_MODEL_CALLS; call++) {
      const output = await session.next(results);
      if (!output.toolCalls.length) {
        replyText = output.text;
        break;
      }
      results = [];
      for (const tc of output.toolCalls.slice(0, MAX_TOOL_CALLS_PER_STEP)) {
        let result: unknown;
        let isError = false;
        if (tc.name === 'confirm_pending_action' || tc.name === 'decline_pending_action') {
          if (!pending) {
            result = { error: 'NOTHING_PENDING' };
            isError = true;
          } else if (tc.name === 'decline_pending_action') {
            await setPendingStatus(prisma, pending.row, 'declined');
            pending = null;
            result = { status: 'declined', note: 'Nothing was changed.' };
          } else {
            try {
              const action = await executePending(prisma, userId, pending.payload.spec);
              actions.push(action);
              result = { status: 'done', action };
            } catch (e) {
              if (!(e instanceof AppError)) throw e;
              result = { error: e.code, message: e.message };
              isError = true;
            }
            await setPendingStatus(prisma, pending.row, 'confirmed');
            pending = null;
          }
        } else {
          const outcome = await runTool(ctx, tc.name, tc.args);
          result = outcome.result;
          isError = outcome.isError;
          if (outcome.action) actions.push(outcome.action);
          if (outcome.pending) newPending = outcome.pending;
        }
        toolRecords.push({ name: tc.name, args: tc.args, result, isError });
        results.push({ callId: tc.id, name: tc.name, content: JSON.stringify(result), isError });
      }
    }
  } catch (e) {
    if (!(e instanceof LlmError)) throw e;
    logger.warn({ kind: e.kind, err: e.message }, 'Assistant model call failed');
    modelFailed = true;
    if (!actions.length && !newPending) {
      throw e.kind === 'rate_limited'
        ? new AppError(503, 'ASSISTANT_BUSY', 'The assistant is busy. Please try again shortly.')
        : new AppError(503, 'ASSISTANT_UNAVAILABLE', 'The assistant is unavailable right now');
    }
  }
  if (!replyText) {
    // The model failed or stopped without words: describe exactly what the database says happened.
    if (newPending) replyText = `${newPending.summary}?`;
    else if (modelFailed) replyText = fallbackReply(actions, language);
    else
      replyText =
        actions.map((a) => describeAction(a, language)).join(' ') || fallbackReply([], language);
  }

  // Persist the turn. Explicit timestamps keep the order stable within one transaction.
  const t0 = Date.now();
  const at = (i: number) => new Date(t0 + i);
  const stored = await prisma.$transaction(async (tx) => {
    const conv =
      conversation ??
      (await tx.conversation.create({
        data: { userId, title: input.text.slice(0, 60), language },
      }));
    const userMessage = await tx.conversationMessage.create({
      data: {
        conversationId: conv.id,
        userId,
        role: 'USER',
        content: input.text,
        language,
        createdAt: at(0),
      },
    });
    let i = 1;
    for (const r of toolRecords) {
      await tx.conversationMessage.create({
        data: {
          conversationId: conv.id,
          userId,
          role: 'TOOL',
          content: '',
          toolName: r.name,
          toolPayload: {
            args: r.args,
            result: r.result,
            isError: r.isError,
          } as Prisma.InputJsonValue,
          createdAt: at(i++),
        },
      });
    }
    let pendingRow: ConversationMessage | null = null;
    if (newPending) {
      const old = await activePending(tx as unknown as PrismaClient, conv.id, now);
      if (old) await setPendingStatus(tx, old.row, 'superseded');
      const payload: PendingPayload = {
        ...newPending,
        status: 'pending',
        language,
        expiresAt: new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
      };
      pendingRow = await tx.conversationMessage.create({
        data: {
          conversationId: conv.id,
          userId,
          role: 'TOOL',
          content: '',
          toolName: PENDING_TOOL,
          toolPayload: payload as unknown as Prisma.InputJsonValue,
          createdAt: at(i++),
        },
      });
    }
    const reply = await tx.conversationMessage.create({
      data: {
        conversationId: conv.id,
        userId,
        role: 'ASSISTANT',
        content: replyText,
        language,
        toolPayload: { actions } as unknown as Prisma.InputJsonValue,
        createdAt: at(i),
      },
    });
    await tx.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
    await audit(tx, {
      userId,
      action: 'assistant.message',
      entityType: 'Conversation',
      entityId: conv.id,
      metadata: {
        provider: llm.name,
        tools: toolRecords.map((r) => r.name),
        actions: actions.map((a) => a.kind),
      },
    });
    return { conv, userMessage, reply, pendingRow };
  });

  const stillPending = stored.pendingRow ?? (pending ? pending.row : null);
  return {
    conversationId: stored.conv.id,
    userMessage: toMessageDto(stored.userMessage),
    reply: toMessageDto(stored.reply),
    pendingAction: stillPending ? toPendingDto(stillPending) : null,
  };
}

/** Confirms or declines the waiting action from its card in the app (no model involved). */
export async function decidePending(
  deps: AssistantDeps,
  userId: string,
  conversationId: string,
  pendingId: string,
  decision: 'confirm' | 'decline',
): Promise<PendingDecisionDto> {
  const { prisma } = deps;
  await findConversation(prisma, userId, conversationId);
  const row = await prisma.conversationMessage.findFirst({
    where: { id: pendingId, conversationId, userId, toolName: PENDING_TOOL },
  });
  if (!row) throw notFound('Pending action');
  const payload = row.toolPayload as unknown as PendingPayload;
  const lang = payload.language;
  const active = await activePending(prisma, conversationId);

  let text: string;
  let actions: AssistantActionDto[] = [];
  if (!active || active.row.id !== row.id) {
    text = messages(lang).expired;
  } else if (decision === 'decline') {
    await setPendingStatus(prisma, row, 'declined');
    text = messages(lang).declined;
  } else {
    // Mark first so a double tap cannot apply the action twice.
    await setPendingStatus(prisma, row, 'confirmed');
    const action = await executePending(prisma, userId, payload.spec);
    actions = [action];
    text = describeAction(action, lang);
  }

  const reply = await prisma.conversationMessage.create({
    data: {
      conversationId,
      userId,
      role: 'ASSISTANT',
      content: text,
      language: lang,
      toolPayload: { actions } as unknown as Prisma.InputJsonValue,
    },
  });
  return { conversationId, reply: toMessageDto(reply) };
}

export async function getConversation(
  prisma: PrismaClient,
  userId: string,
  conversationId: string | 'latest',
): Promise<ConversationDto | null> {
  const conversation =
    conversationId === 'latest'
      ? await prisma.conversation.findFirst({
          where: { userId, archivedAt: null },
          orderBy: { updatedAt: 'desc' },
        })
      : await findConversation(prisma, userId, conversationId);
  if (!conversation) return null;
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId: conversation.id, role: { in: ['USER', 'ASSISTANT'] } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const pending = await activePending(prisma, conversation.id);
  return {
    id: conversation.id,
    messages: rows.reverse().map(toMessageDto),
    pendingAction: pending ? toPendingDto(pending.row) : null,
  };
}
