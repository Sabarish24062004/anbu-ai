import type { PrismaClient } from '../../database/prisma';

// Delivered, failed and cancelled reminders are kept this long for history, then removed.
export const REMINDER_HISTORY_DAYS = 90;

/**
 * Removes data that has served its purpose. Revoked refresh tokens are kept until they expire:
 * replay detection needs them while a stolen copy could still be presented.
 */
export async function runMaintenance(prisma: PrismaClient, now = new Date()) {
  const historyCutoff = new Date(now.getTime() - REMINDER_HISTORY_DAYS * 86_400_000);
  const [idempotencyKeys, refreshTokens, reminders] = await Promise.all([
    prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.reminder.deleteMany({
      where: {
        status: { in: ['SENT', 'FAILED', 'CANCELLED'] },
        occurrenceAt: { lt: historyCutoff },
      },
    }),
  ]);
  return {
    idempotencyKeys: idempotencyKeys.count,
    refreshTokens: refreshTokens.count,
    reminders: reminders.count,
  };
}
