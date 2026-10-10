import type { Logger } from 'pino';
import type { PrismaClient } from '../../database/prisma';
import { dispatchDueReminders } from './dispatcher';
import { resyncAllReminders } from './sync';

const HORIZON_INTERVAL_MS = 60 * 60_000;

/**
 * Runs inside the API process. On start it re-plans every user's reminders (so anything that came
 * due while the server was down is picked up), then dispatches due reminders on a fixed interval
 * and extends the planning horizon hourly. Runs never overlap.
 */
export function startReminderWorker(opts: {
  prisma: PrismaClient;
  logger: Logger;
  pollIntervalMs: number;
}) {
  const { prisma, logger } = opts;
  const log = logger.child({ component: 'reminder-worker' });
  let running: Promise<void> | null = null;
  let lastHorizonRun = 0;
  let stopped = false;

  const tick = async () => {
    const now = new Date();
    if (now.getTime() - lastHorizonRun >= HORIZON_INTERVAL_MS) {
      const users = await resyncAllReminders(prisma, now);
      lastHorizonRun = now.getTime();
      log.debug({ users }, 'Reminder horizon extended');
    }
    await dispatchDueReminders(prisma, log, now);
  };

  const run = () => {
    if (running || stopped) return;
    running = tick()
      .catch((err: unknown) => log.error({ err }, 'Reminder worker run failed'))
      .finally(() => {
        running = null;
      });
  };

  run();
  const timer = setInterval(run, opts.pollIntervalMs);
  log.info({ pollIntervalMs: opts.pollIntervalMs }, 'Reminder worker started');

  return async function stop() {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
