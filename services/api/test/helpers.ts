import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import type { AuthResponse } from '@anbu/shared';
import { createApp } from '../src/app';
import { createLogger } from '../src/common/logger';
import { loadEnv } from '../src/config/env';
import { createPrismaClient, type PrismaClient } from '../src/database/prisma';

export const TEST_EMAIL_DOMAIN = '@example.test';
export const TEST_PASSWORD = 'correct horse battery staple';

export function buildTestApp(overrides: { databaseUrl?: string } = {}) {
  const env = loadEnv();
  const prisma = createPrismaClient(overrides.databaseUrl ?? env.DATABASE_URL);
  const app = createApp({ env, prisma, logger: createLogger('silent') });
  return { app, prisma, env };
}

export async function registerUser(app: Express, overrides: Record<string, unknown> = {}) {
  const email = `user-${randomUUID()}${TEST_EMAIL_DOMAIN}`;
  const res = await request(app)
    .post('/auth/register')
    .send({ email, password: TEST_PASSWORD, timezone: 'Asia/Kolkata', ...overrides });
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body as AuthResponse;
  return {
    email,
    userId: body.user.id,
    tokens: body.tokens,
    auth: { Authorization: `Bearer ${body.tokens.accessToken}` },
  };
}

/** Removes every user created by tests; owned rows cascade. */
export function deleteTestUsers(prisma: PrismaClient) {
  return prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}
