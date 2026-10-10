import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/common/logger';
import {
  dispatchDueReminders,
  inAppChannel,
  type ReminderChannel,
} from '../src/modules/reminders/dispatcher';
import { resyncUserReminders } from '../src/modules/reminders/sync';
import { buildTestApp, deleteTestUsers, registerUser } from './helpers';

const { app, prisma } = buildTestApp();
const logger = createLogger('silent');
let user: Awaited<ReturnType<typeof registerUser>>;

beforeAll(async () => {
  user = await registerUser(app);
});
afterAll(async () => {
  await deleteTestUsers(prisma);
  await prisma.$disconnect();
});

/** A local wall-clock time `minutes` from now, in the format the app sends. */
const inMinutes = (minutes: number) =>
  DateTime.now()
    .setZone('Asia/Kolkata')
    .plus({ minutes })
    .startOf('minute')
    .toFormat("yyyy-MM-dd'T'HH:mm");
const later = (ms: number) => new Date(Date.now() + ms);

async function createEvent(body: Record<string, unknown>) {
  const res = await request(app)
    .post('/events')
    .set(user.auth)
    .send({ allowConflicts: true, ...body });
  expect(res.status).toBe(201);
  return res.body.event.id as string;
}

const remindersOf = (eventId: string) =>
  prisma.reminder.findMany({ where: { eventId }, orderBy: { triggerAt: 'asc' } });

describe('planning on create, update and cancel', () => {
  it('creates a pending reminder that the app can schedule', async () => {
    const id = await createEvent({
      title: 'Doctor',
      startAt: inMinutes(24 * 60),
      reminderOffsets: [30],
    });
    const rows = await remindersOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'PENDING', offsetMinutes: 30 });
    expect(rows[0]!.occurrenceAt.getTime() - rows[0]!.triggerAt.getTime()).toBe(30 * 60_000);

    const res = await request(app).get('/reminders/upcoming?hours=48').set(user.auth);
    const mine = res.body.reminders.find((r: { source: { id: string } }) => r.source.id === id);
    expect(mine).toMatchObject({ source: { type: 'event', title: 'Doctor', dateOnly: false } });
  });

  it('moves reminders when the event moves and cancels them when the event is cancelled', async () => {
    const id = await createEvent({ title: 'Meeting', startAt: inMinutes(2 * 24 * 60) });
    await request(app)
      .patch(`/events/${id}`)
      .set(user.auth)
      .send({ startAt: inMinutes(3 * 24 * 60), allowConflicts: true });
    let rows = await remindersOf(id);
    expect(rows.map((r) => r.status).sort()).toEqual(['CANCELLED', 'PENDING']);

    await request(app).post(`/events/${id}/cancel`).set(user.auth);
    rows = await remindersOf(id);
    expect(rows.every((r) => r.status === 'CANCELLED')).toBe(true);
  });

  it('reminds about tasks and important dates', async () => {
    const task = await request(app)
      .post('/tasks')
      .set(user.auth)
      .send({ title: 'Pay bill', dueAt: inMinutes(5 * 60), reminderOffsets: [60] });
    expect(await prisma.reminder.count({ where: { taskId: task.body.task.id } })).toBe(1);

    await request(app).post(`/tasks/${task.body.task.id}/complete`).set(user.auth);
    const after = await prisma.reminder.findMany({ where: { taskId: task.body.task.id } });
    expect(after.map((r) => r.status)).toEqual(['CANCELLED']);

    const soon = DateTime.now().setZone('Asia/Kolkata').plus({ days: 3 });
    const date = await request(app)
      .post('/important-dates')
      .set(user.auth)
      .send({ title: 'Amma birthday', type: 'BIRTHDAY', month: soon.month, day: soon.day });
    const rows = await prisma.reminder.findMany({
      where: { importantDateId: date.body.importantDate.id },
    });
    expect(rows).toHaveLength(2); // the day before and on the day
  });
});

describe('dispatching', () => {
  it('fires a due reminder once and shows it as due in the app', async () => {
    // Starts in 10 minutes with a 15-minute lead: too late for the lead, so it is due now.
    const id = await createEvent({ title: 'Call Ravi', startAt: inMinutes(10) });
    const [row] = await remindersOf(id);
    expect(row!.triggerAt.getTime()).toBeLessThanOrEqual(Date.now());

    const first = await dispatchDueReminders(prisma, logger, later(1000));
    const second = await dispatchDueReminders(prisma, logger, later(2000));
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect(second.sent).toBe(0);

    const sent = await prisma.reminder.findUniqueOrThrow({
      where: { id: row!.id },
      include: { attempts: true },
    });
    expect(sent.status).toBe('SENT');
    expect(sent.attempts).toHaveLength(1);

    const due = await request(app).get('/reminders/due').set(user.auth);
    expect(due.body.reminders.map((r: { id: string }) => r.id)).toContain(row!.id);

    await request(app)
      .post(`/reminders/${row!.id}/acknowledge`)
      .set(user.auth)
      .send({ action: 'DISMISSED' });
    const dueAfter = await request(app).get('/reminders/due').set(user.auth);
    expect(dueAfter.body.reminders.map((r: { id: string }) => r.id)).not.toContain(row!.id);
  });

  it('never delivers a reminder twice when dispatchers run concurrently', async () => {
    const id = await createEvent({ title: 'Parallel', startAt: inMinutes(12) });
    const [row] = await remindersOf(id);
    const results = await Promise.all(
      [1, 2, 3].map(() => dispatchDueReminders(prisma, logger, later(1000))),
    );
    expect(results.reduce((n, r) => n + r.sent, 0)).toBeGreaterThanOrEqual(1);
    const attempts = await prisma.reminderDeliveryAttempt.count({ where: { reminderId: row!.id } });
    expect(attempts).toBe(1);
  });

  it('snoozes a fired reminder and fires it again later', async () => {
    const id = await createEvent({ title: 'Medicine', startAt: inMinutes(8) });
    const [row] = await remindersOf(id);
    await dispatchDueReminders(prisma, logger, later(1000));

    const snooze = await request(app)
      .post(`/reminders/${row!.id}/snooze`)
      .set(user.auth)
      .send({ minutes: 5 });
    expect(snooze.status).toBe(200);
    expect(snooze.body.reminder).toMatchObject({ status: 'PENDING', snoozeCount: 1 });

    // Re-planning must not pull the snoozed reminder back to its original time.
    await resyncUserReminders(prisma, user.userId);
    const snoozed = await prisma.reminder.findUniqueOrThrow({ where: { id: row!.id } });
    expect(snoozed.triggerAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);

    await dispatchDueReminders(prisma, logger, later(6 * 60_000));
    const again = await prisma.reminder.findUniqueOrThrow({ where: { id: row!.id } });
    expect(again.status).toBe('SENT');
  });

  it('marks reminders missed while the server was down instead of sending them late', async () => {
    const id = await createEvent({
      title: 'Missed',
      startAt: inMinutes(20),
      reminderOffsets: [15],
    });
    const [row] = await remindersOf(id);
    // Pretend the server only comes back an hour after the event started.
    const result = await dispatchDueReminders(prisma, logger, later(80 * 60_000));
    expect(result.missed).toBeGreaterThanOrEqual(1);
    const missed = await prisma.reminder.findUniqueOrThrow({ where: { id: row!.id } });
    expect(missed.status).toBe('FAILED');
    expect(missed.lastError).toMatch(/MISSED/);
  });

  it('recovers reminders left in PROCESSING by a crashed worker', async () => {
    const id = await createEvent({ title: 'Crash', startAt: inMinutes(9) });
    const [row] = await remindersOf(id);
    await prisma.$executeRaw`
      UPDATE "Reminder"
      SET "status" = 'PROCESSING', "updatedAt" = now() - interval '10 minutes'
      WHERE "id" = ${row!.id}::uuid`;
    const result = await dispatchDueReminders(prisma, logger, later(1000));
    expect(result.recovered).toBeGreaterThanOrEqual(1);
    const recovered = await prisma.reminder.findUniqueOrThrow({ where: { id: row!.id } });
    expect(recovered.status).toBe('SENT');
  });

  it('retries a failing channel, then gives up and records why', async () => {
    const id = await createEvent({ title: 'Flaky', startAt: inMinutes(9) });
    const [row] = await remindersOf(id);
    const broken: ReminderChannel = {
      name: 'PUSH',
      deliver: () => Promise.reject(new Error('push service down')),
    };
    let t = Date.now() + 1000;
    for (let i = 0; i < 3; i++) {
      await dispatchDueReminders(prisma, logger, new Date(t), [broken]);
      t += 5 * 60_000; // past each retry delay, still before the event is missed
    }
    const failed = await prisma.reminder.findUniqueOrThrow({
      where: { id: row!.id },
      include: { attempts: true },
    });
    expect(failed.status).toBe('FAILED');
    expect(failed.lastError).toBe('push service down');
    expect(failed.attempts).toHaveLength(3);
    expect(inAppChannel.name).toBe('IN_APP');
  });
});

describe('ownership', () => {
  it("cannot snooze or acknowledge another user's reminder", async () => {
    const id = await createEvent({ title: 'Private', startAt: inMinutes(24 * 60) });
    const [row] = await remindersOf(id);
    const other = await registerUser(app);
    const res = await request(app)
      .post(`/reminders/${row!.id}/acknowledge`)
      .set(other.auth)
      .send({ action: 'DISMISSED' });
    expect(res.status).toBe(404);
  });
});
