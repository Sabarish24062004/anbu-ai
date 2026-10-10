import { DateTime } from 'luxon';
import type { Logger } from 'pino';
import type { Language } from '@anbu/shared';
import type { PrismaClient } from '../../database/prisma';
import type { Reminder } from '../../generated/prisma/client';
import type { ReminderChannel } from './dispatcher';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TIMEOUT_MS = 15_000;
const MAX_PER_REQUEST = 100;

const T = {
  en: {
    startsAt: (time: string) => `Starts at ${time}`,
    startingNow: 'Starting now',
    dueAt: (time: string) => `Due at ${time}`,
    inDays: (n: number) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`),
  },
  ta: {
    startsAt: (time: string) => `${time}க்குத் தொடங்கும்`,
    startingNow: 'இப்போது தொடங்குகிறது',
    dueAt: (time: string) => `${time}க்குள் முடிக்க வேண்டும்`,
    inDays: (n: number) => (n === 0 ? 'இன்று' : n === 1 ? 'நாளை' : `${n} நாட்களில்`),
  },
};

interface Ticket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Title, body and in-app link for a reminder, in the user's language. Same wording as the app. */
export async function pushContent(prisma: PrismaClient, reminder: Reminder) {
  const r = await prisma.reminder.findUniqueOrThrow({
    where: { id: reminder.id },
    include: {
      user: { select: { language: true } },
      event: { select: { id: true, title: true, timezone: true, allDay: true } },
      task: { select: { id: true, title: true, timezone: true } },
      importantDate: { select: { id: true, title: true } },
    },
  });
  const lang: Language = r.user.language;
  const t = T[lang];
  const time = (zone: string) =>
    DateTime.fromJSDate(r.occurrenceAt, { zone })
      .setLocale(lang === 'ta' ? 'ta-IN' : 'en-IN')
      .toLocaleString(DateTime.TIME_SIMPLE);
  const days = Math.round(r.offsetMinutes / 1440);
  if (r.event) {
    const body = r.event.allDay
      ? t.inDays(days)
      : r.offsetMinutes === 0
        ? t.startingNow
        : t.startsAt(time(r.event.timezone));
    return { title: r.event.title, body, path: `/event/${r.event.id}` };
  }
  if (r.task) {
    return {
      title: r.task.title,
      body: t.dueAt(time(r.task.timezone)),
      path: `/task/${r.task.id}`,
    };
  }
  return {
    title: r.importantDate!.title,
    body: t.inDays(days),
    path: `/date/${r.importantDate!.id}`,
  };
}

/**
 * Remote push through Expo's push service. Devices without a token (Expo Go) are skipped; tokens
 * Expo reports as no longer registered are retired. Throwing makes the dispatcher retry.
 */
export function createExpoPushChannel(opts: {
  prisma: PrismaClient;
  logger: Logger;
  accessToken?: string;
}): ReminderChannel {
  const { prisma, logger } = opts;
  return {
    name: 'PUSH',
    async deliver(reminder) {
      const devices = await prisma.notificationDevice.findMany({
        where: { userId: reminder.userId, revokedAt: null, pushToken: { not: null } },
      });
      if (!devices.length) return 'skipped';

      const { title, body, path } = await pushContent(prisma, reminder);
      // Keep trying to deliver until shortly after the occurrence, then let it go.
      const ttl = Math.max(
        60,
        Math.round((reminder.occurrenceAt.getTime() - Date.now()) / 1000) + 600,
      );
      const messages = devices.slice(0, MAX_PER_REQUEST).map((d) => ({
        to: d.pushToken,
        title,
        body,
        data: { path, reminderId: reminder.id },
        sound: 'default',
        priority: 'high',
        channelId: 'reminders',
        ttl,
      }));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
          },
          body: JSON.stringify(messages),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const json = (await res.json().catch(() => null)) as { data?: Ticket[] } | null;
      if (!res.ok || !json?.data) throw new Error(`Expo push HTTP ${res.status}`);

      const gone = json.data
        .map((ticket, i) =>
          ticket.details?.error === 'DeviceNotRegistered' ? devices[i]?.id : null,
        )
        .filter((id): id is string => !!id);
      if (gone.length) {
        await prisma.notificationDevice.updateMany({
          where: { id: { in: gone } },
          data: { revokedAt: new Date() },
        });
        logger.info({ devices: gone.length }, 'Retired push tokens that are no longer registered');
      }
      if (json.data.some((t) => t.status === 'ok')) return 'delivered';
      if (gone.length === json.data.length) return 'skipped';
      throw new Error(json.data.find((t) => t.status === 'error')?.message ?? 'Push rejected');
    },
  };
}
