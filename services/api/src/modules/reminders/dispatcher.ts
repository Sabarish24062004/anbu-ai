import type { Logger } from 'pino';
import type { PrismaClient } from '../../database/prisma';
import type { DeliveryChannel, Reminder } from '../../generated/prisma/client';

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;
// A row stuck in PROCESSING this long belongs to a worker that died mid-delivery.
const STALE_PROCESSING_MS = 5 * 60_000;
// Past this point after the occurrence has started, a late reminder is no longer useful.
const MISSED_AFTER_MS = 10 * 60_000;
const RETRY_DELAY_MS = 60_000;

/** Delivers one reminder over one channel. Throwing means "not delivered". */
export interface ReminderChannel {
  name: DeliveryChannel;
  deliver(reminder: Reminder): Promise<void>;
}

/**
 * IN_APP: the reminder becomes visible in the app's "due now" list (GET /reminders/due). Phones
 * also show it as a local notification scheduled from GET /reminders/upcoming. Remote push needs a
 * development build and is a later channel.
 */
export const inAppChannel: ReminderChannel = {
  name: 'IN_APP',
  deliver: async () => undefined,
};

export interface DispatchResult {
  recovered: number;
  sent: number;
  missed: number;
  failed: number;
  retried: number;
}

/**
 * Fires every due reminder exactly once. Rows are claimed with FOR UPDATE SKIP LOCKED, so several
 * workers (or overlapping runs) never claim the same row, and the PENDING → PROCESSING → SENT
 * transitions are conditional, so a reminder is never delivered twice.
 */
export async function dispatchDueReminders(
  prisma: PrismaClient,
  logger: Logger,
  now = new Date(),
  channels: ReminderChannel[] = [inAppChannel],
): Promise<DispatchResult> {
  const result: DispatchResult = { recovered: 0, sent: 0, missed: 0, failed: 0, retried: 0 };

  const stale = await prisma.reminder.updateMany({
    where: {
      status: 'PROCESSING',
      updatedAt: { lt: new Date(now.getTime() - STALE_PROCESSING_MS) },
    },
    data: { status: 'PENDING' },
  });
  result.recovered = stale.count;

  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Reminder"
    SET "status" = 'PROCESSING'::"ReminderStatus",
        "attemptCount" = "attemptCount" + 1,
        "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "Reminder"
      WHERE "status" = 'PENDING'::"ReminderStatus" AND "triggerAt" <= ${now}
      ORDER BY "triggerAt"
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  if (!claimed.length) return result;

  const reminders = await prisma.reminder.findMany({
    where: { id: { in: claimed.map((c) => c.id) } },
  });
  for (const reminder of reminders) {
    const outcome = await deliverOne(prisma, reminder, now, channels);
    result[outcome]++;
  }
  if (result.sent || result.missed || result.failed) logger.info(result, 'Reminders dispatched');
  return result;
}

async function deliverOne(
  prisma: PrismaClient,
  reminder: Reminder,
  now: Date,
  channels: ReminderChannel[],
): Promise<'sent' | 'missed' | 'failed' | 'retried'> {
  // Usually the server was down when this was due. Say so rather than send a stale alert.
  if (now.getTime() > reminder.occurrenceAt.getTime() + MISSED_AFTER_MS) {
    await prisma.reminder.updateMany({
      where: { id: reminder.id, status: 'PROCESSING' },
      data: { status: 'FAILED', lastError: 'MISSED: not delivered before the occurrence' },
    });
    return 'missed';
  }

  let delivered = false;
  let lastError: string | null = null;
  const attempts: { channel: DeliveryChannel; result: 'SUCCESS' | 'FAILURE'; error?: string }[] =
    [];
  for (const channel of channels) {
    try {
      await channel.deliver(reminder);
      delivered = true;
      attempts.push({ channel: channel.name, result: 'SUCCESS' });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      attempts.push({ channel: channel.name, result: 'FAILURE', error: lastError.slice(0, 500) });
    }
  }

  const finalFailure = !delivered && reminder.attemptCount >= MAX_ATTEMPTS;
  await prisma.$transaction(async (tx) => {
    await tx.reminderDeliveryAttempt.createMany({
      data: attempts.map((a) => ({ reminderId: reminder.id, attemptedAt: now, ...a })),
    });
    await tx.reminder.updateMany({
      where: { id: reminder.id, status: 'PROCESSING' },
      data: delivered
        ? { status: 'SENT', sentAt: now, lastError: null }
        : finalFailure
          ? { status: 'FAILED', lastError }
          : {
              status: 'PENDING',
              lastError,
              triggerAt: new Date(now.getTime() + RETRY_DELAY_MS * reminder.attemptCount),
            },
    });
  });
  return delivered ? 'sent' : finalFailure ? 'failed' : 'retried';
}
