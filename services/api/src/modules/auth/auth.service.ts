import { randomUUID } from 'node:crypto';
import type { AuthResponse, AuthTokens, LoginInput, RegisterInput } from '@anbu/shared';
import type { Logger } from 'pino';
import { audit } from '../../common/audit';
import { AppError } from '../../common/errors';
import type { PrismaClient } from '../../database/prisma';
import { Prisma } from '../../generated/prisma/client';
import { toUserDto } from '../users/users.mapper';
import { getDummyHash, hashPassword, verifyPassword } from './password';
import { createAccessToken, generateRefreshToken, hashToken, type TokenConfig } from './tokens';

export interface AuthContext {
  prisma: PrismaClient;
  tokens: TokenConfig;
  logger: Logger;
}

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
const invalidRefresh = () =>
  new AppError(401, 'INVALID_REFRESH_TOKEN', 'Session expired, please sign in again');

type Db = PrismaClient | Prisma.TransactionClient;

async function issueTokens(
  db: Db,
  ctx: AuthContext,
  userId: string,
  familyId: string,
  userAgent?: string,
) {
  const access = await createAccessToken(userId, ctx.tokens);
  const refresh = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + ctx.tokens.refreshTtlDays * 86_400_000);
  const row = await db.refreshToken.create({
    data: {
      userId,
      tokenHash: refresh.hash,
      familyId,
      expiresAt: refreshExpiresAt,
      userAgent: userAgent?.slice(0, 200),
    },
  });
  const tokens: AuthTokens = {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
  };
  return { tokens, refreshTokenId: row.id };
}

export async function register(
  ctx: AuthContext,
  input: RegisterInput & { email: string },
  defaults: { timezone: string },
  userAgent?: string,
): Promise<AuthResponse> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await ctx.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          timezone: input.timezone ?? defaults.timezone,
          language: input.language,
          preference: { create: {} },
        },
      });
      await audit(tx, {
        userId: user.id,
        action: 'user.register',
        entityType: 'User',
        entityId: user.id,
      });
      const { tokens } = await issueTokens(tx, ctx, user.id, randomUUID(), userAgent);
      return { user: toUserDto(user), tokens };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw e;
  }
}

export async function login(
  ctx: AuthContext,
  input: LoginInput,
  userAgent?: string,
): Promise<AuthResponse> {
  const user = await ctx.prisma.user.findUnique({ where: { email: input.email } });
  if (!user || user.deletedAt) {
    // Spend the same time as a real check so response timing does not reveal which emails exist.
    await verifyPassword(input.password, await getDummyHash());
    throw invalidCredentials();
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) throw invalidCredentials();

  const { tokens } = await issueTokens(ctx.prisma, ctx, user.id, randomUUID(), userAgent);
  return { user: toUserDto(user), tokens };
}

/**
 * Rotates a refresh token. Each token is single-use; presenting a used token means it was copied,
 * so the whole family (every session descended from that sign-in) is revoked.
 */
export async function refresh(
  ctx: AuthContext,
  rawToken: string,
  userAgent?: string,
): Promise<AuthResponse> {
  const row = await ctx.prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!row) throw invalidRefresh();

  const now = new Date();
  if (row.revokedAt) {
    await revokeFamily(ctx.prisma, row.familyId, now);
    ctx.logger.warn({ userId: row.userId, familyId: row.familyId }, 'Refresh token reuse detected');
    throw invalidRefresh();
  }
  if (row.expiresAt <= now || row.user.deletedAt) throw invalidRefresh();

  const result = await ctx.prisma.$transaction(async (tx) => {
    // Conditional update: only one concurrent request can consume a given token.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (claimed.count === 0) return null;
    const issued = await issueTokens(tx, ctx, row.userId, row.familyId, userAgent);
    await tx.refreshToken.update({
      where: { id: row.id },
      data: { replacedBy: issued.refreshTokenId },
    });
    return issued.tokens;
  });
  if (!result) {
    await revokeFamily(ctx.prisma, row.familyId, now);
    throw invalidRefresh();
  }
  return { user: toUserDto(row.user), tokens: result };
}

/** Ends the session the token belongs to. Unknown tokens are ignored so logout always succeeds. */
export async function logout(ctx: AuthContext, rawToken: string): Promise<void> {
  const row = await ctx.prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (row) await revokeFamily(ctx.prisma, row.familyId, new Date());
}

function revokeFamily(prisma: PrismaClient, familyId: string, now: Date) {
  return prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: now },
  });
}
