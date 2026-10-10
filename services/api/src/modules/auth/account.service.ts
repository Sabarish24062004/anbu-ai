import { randomUUID } from 'node:crypto';
import type { AuthResponse } from '@anbu/shared';
import { audit } from '../../common/audit';
import { AppError } from '../../common/errors';
import { getActiveUser } from '../users/users.service';
import { toUserDto } from '../users/users.mapper';
import type { AuthContext } from './auth.service';
import { issueTokens } from './auth.service';
import { hashPassword, verifyPassword } from './password';

const wrongPassword = () =>
  new AppError(403, 'WRONG_PASSWORD', 'The current password is not correct');

async function checkPassword(ctx: AuthContext, userId: string, password: string) {
  const user = await getActiveUser(ctx.prisma, userId);
  if (!(await verifyPassword(password, user.passwordHash))) throw wrongPassword();
  return user;
}

/**
 * Changes the password and signs out every other session (all refresh tokens are revoked);
 * the caller gets fresh tokens so this device stays signed in.
 */
export async function changePassword(
  ctx: AuthContext,
  userId: string,
  input: { currentPassword: string; newPassword: string },
  userAgent?: string,
): Promise<AuthResponse> {
  await checkPassword(ctx, userId, input.currentPassword);
  const passwordHash = await hashPassword(input.newPassword);
  return ctx.prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(tx, {
      userId,
      action: 'user.password_change',
      entityType: 'User',
      entityId: userId,
    });
    const { tokens } = await issueTokens(tx, ctx, userId, randomUUID(), userAgent);
    return { user: toUserDto(user), tokens };
  });
}

/**
 * Everything stored about the user, as one JSON document. Secrets (password hash, token hashes,
 * idempotency records) are left out; they are not the user's data and would only be a risk.
 */
export async function exportAccount(ctx: AuthContext, userId: string) {
  const { prisma } = ctx;
  const user = await getActiveUser(prisma, userId);
  const where = { userId };
  const [
    preference,
    events,
    tasks,
    importantDates,
    reminders,
    memories,
    conversations,
    devices,
    auditLog,
  ] = await Promise.all([
    prisma.userPreference.findUnique({ where }),
    prisma.event.findMany({ where, orderBy: { startAt: 'asc' } }),
    prisma.task.findMany({ where, orderBy: { createdAt: 'asc' } }),
    prisma.importantDate.findMany({ where, orderBy: [{ month: 'asc' }, { day: 'asc' }] }),
    prisma.reminder.findMany({
      where,
      orderBy: { triggerAt: 'asc' },
      include: { attempts: true },
    }),
    prisma.memory.findMany({ where, orderBy: { key: 'asc' } }),
    prisma.conversation.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    }),
    prisma.notificationDevice.findMany({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } }),
  ]);
  await prisma.$transaction((tx) =>
    audit(tx, { userId, action: 'user.export', entityType: 'User', entityId: userId }),
  );
  return {
    exportedAt: new Date().toISOString(),
    format: 'anbu-ai-export/1',
    user: toUserDto(user),
    preference,
    events,
    tasks,
    importantDates,
    reminders,
    memories,
    conversations,
    devices: devices.map(({ pushToken: _token, ...d }) => d),
    auditLog,
  };
}

/**
 * Permanently deletes the account and everything that belongs to it (database cascades). Audit
 * entries stay, detached from the user, as a record that a deletion happened.
 */
export async function deleteAccount(ctx: AuthContext, userId: string, password: string) {
  await checkPassword(ctx, userId, password);
  await ctx.prisma.$transaction(async (tx) => {
    await audit(tx, { userId, action: 'user.delete', entityType: 'User', entityId: userId });
    await tx.user.delete({ where: { id: userId } });
  });
  ctx.logger.info('Account deleted');
}
