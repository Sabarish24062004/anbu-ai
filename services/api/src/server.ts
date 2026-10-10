import 'dotenv/config';
import { createApp } from './app';
import { createLogger } from './common/logger';
import { loadEnv } from './config/env';
import { createPrismaClient } from './database/prisma';
import { startReminderWorker } from './modules/reminders/worker';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const prisma = createPrismaClient(env.DATABASE_URL);
const app = createApp({ env, prisma, logger });

// Listen on all interfaces so a phone on the same Wi-Fi can reach the dev server.
const server = app.listen(env.PORT, '0.0.0.0', () => {
  logger.info({ port: env.PORT }, `${env.APP_NAME} API listening`);
});

const stopReminderWorker = env.REMINDER_WORKER_ENABLED
  ? startReminderWorker({ prisma, logger, pollIntervalMs: env.REMINDER_POLL_SECONDS * 1000 })
  : undefined;

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await stopReminderWorker?.();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
