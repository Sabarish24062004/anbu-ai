import type { Logger } from 'pino';
import type { PrismaClient } from '../../database/prisma';
import { dispatchDueReminders, inAppChannel, type ReminderChannel } from './dispatcher';
import { runMaintenance } from './maintenance';
import { resyncAllReminders } from './sync';

const HORIZON_INTERVAL_MS = 60 * 60_000;

/**
 * Runs inside the API process. On start it re-plans every user's reminders (so anything that came
 * due while the server was down is picked up), then dispatches due reminders on a fixed interval.
 * Hourly it extends the planning horizon and removes expired data (see maintenance.ts).
 * Runs never overlap.
 */
export function startReminderWorker(opts: {
  prisma: PrismaClient;
  logger: Logger;
  pollIntervalMs: number;
  channels?: ReminderChannel[];
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
      const removed = await runMaintenance(prisma, now);
      lastHorizonRun = now.getTime();
      log.debug({ users, removed }, 'Reminder horizon extended and old data removed');
    }
    await dispatchDueReminders(prisma, log, now, opts.channels ?? [inAppChannel]);
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
