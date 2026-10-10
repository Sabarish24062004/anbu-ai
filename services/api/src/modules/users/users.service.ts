import {
  DEFAULT_REMINDER_LEAD_MINUTES,
  type MeResponse,
  type UpdateMeInput,
  type UpdatePreferencesInput,
} from '@anbu/shared';
import { audit } from '../../common/audit';
import { AppError } from '../../common/errors';
import type { PrismaClient } from '../../database/prisma';
import { toPreferencesDto, toUserDto } from './users.mapper';

/** Loads the signed-in user; a deleted account is treated as signed out. */
export async function getActiveUser(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) throw new AppError(401, 'UNAUTHORIZED', 'Sign in required');
  return user;
}

/** Defaults applied when a request omits them: the user's timezone and reminder lead time. */
export async function getUserDefaults(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { preference: true },
  });
  if (!user || user.deletedAt) throw new AppError(401, 'UNAUTHORIZED', 'Sign in required');
  return {
    timezone: user.timezone,
    reminderLeadMinutes:
      user.preference?.defaultReminderLeadMinutes ?? DEFAULT_REMINDER_LEAD_MINUTES,
  };
}

export async function getMe(prisma: PrismaClient, userId: string): Promise<MeResponse> {
  const user = await getActiveUser(prisma, userId);
  const preferences = await prisma.userPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  return { user: toUserDto(user), preferences: toPreferencesDto(preferences) };
}

export async function updateMe(prisma: PrismaClient, userId: string, input: UpdateMeInput) {
  await getActiveUser(prisma, userId);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: input });
    await audit(tx, {
      userId,
      action: 'user.update',
      entityType: 'User',
      entityId: userId,
      metadata: { fields: Object.keys(input) },
    });
  });
  return getMe(prisma, userId);
}

export async function updatePreferences(
  prisma: PrismaClient,
  userId: string,
  input: UpdatePreferencesInput,
) {
  await getActiveUser(prisma, userId);
  await prisma.$transaction(async (tx) => {
    await tx.userPreference.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });
    await audit(tx, {
      userId,
      action: 'preferences.update',
      entityType: 'UserPreference',
      entityId: userId,
      metadata: { fields: Object.keys(input) },
    });
  });
  return getMe(prisma, userId);
}
