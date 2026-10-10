import type { HealthResponse } from '@anbu/shared';
import type { PrismaClient } from '../../database/prisma';

const DB_CHECK_TIMEOUT_MS = 2000;

export async function checkDatabase(prisma: PrismaClient): Promise<'ok' | 'error'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), DB_CHECK_TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

export async function getHealth(
  prisma: PrismaClient,
  meta: { appName: string; version: string },
): Promise<HealthResponse> {
  const database = await checkDatabase(prisma);
  return {
    status: database === 'ok' ? 'ok' : 'degraded',
    appName: meta.appName,
    version: meta.version,
    time: new Date().toISOString(),
    checks: { database },
  };
}
