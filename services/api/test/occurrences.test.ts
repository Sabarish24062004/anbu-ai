import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmOutput } from '../src/modules/assistant/llm/types';
import { callTool, say, scriptedLlm, type TurnContext } from './fake-llm';
import { buildTestApp, deleteTestUsers, registerUser } from './helpers';

let script: (ctx: TurnContext) => LlmOutput = () => say('ok');
const fake = scriptedLlm((ctx) => script(ctx));
const { app, prisma } = buildTestApp({ llm: fake.provider });
let user: Awaited<ReturnType<typeof registerUser>>;

beforeAll(async () => {
  user = await registerUser(app);
});
afterAll(async () => {
  await deleteTestUsers(prisma);
  await prisma.$disconnect();
});

const createDaily = async (title: string, startAt: string, endAt?: string) => {
  const res = await request(app)
    .post('/events')
    .set(user.auth)
    .send({ title, startAt, endAt, rrule: 'FREQ=DAILY', allowConflicts: true });
  expect(res.status).toBe(201);
  return res.body.event.id as string;
};

const occurrencesOf = async (id: string, from: string, to: string) => {
  const res = await request(app).get('/events').query({ from, to }).set(user.auth);
  return (
    res.body.occurrences as {
      eventId: string;
      start: string;
      moved: boolean;
      originalStart: string;
    }[]
  ).filter((o) => o.eventId === id);
};

describe('skipping and moving one occurrence', () => {
  it('skips one day and restores it', async () => {
    const id = await createDaily('Gym', '2027-05-03T06:00', '2027-05-03T07:00');
    const skip = await request(app)
      .post(`/events/${id}/occurrences/skip`)
      .set(user.auth)
      .send({ occurrence: '2027-05-05' });
    expect(skip.status).toBe(200);
    expect(skip.body.exception).toMatchObject({
      kind: 'SKIPPED',
      originalStart: '2027-05-05T06:00:00.000+05:30',
    });

    let days = (await occurrencesOf(id, '2027-05-04', '2027-05-07')).map((o) =>
      o.start.slice(0, 10),
    );
    expect(days).toEqual(['2027-05-04', '2027-05-06']);

    const restore = await request(app)
      .delete(`/events/${id}/exceptions/${skip.body.exception.id}`)
      .set(user.auth);
    expect(restore.status).toBe(204);
    days = (await occurrencesOf(id, '2027-05-04', '2027-05-07')).map((o) => o.start.slice(0, 10));
    expect(days).toEqual(['2027-05-04', '2027-05-05', '2027-05-06']);
  });

  it('moves one occurrence, keeping its length, and lists it at the new time', async () => {
    const id = await createDaily('Class', '2027-06-01T10:00', '2027-06-01T11:00');
    const move = await request(app)
      .post(`/events/${id}/occurrences/move`)
      .set(user.auth)
      .send({ occurrence: '2027-06-02T10:00:00.000+05:30', startAt: '2027-06-02T17:00' });
    expect(move.status).toBe(200);
    expect(move.body.exception).toMatchObject({
      kind: 'MOVED',
      startAt: '2027-06-02T17:00:00.000+05:30',
      endAt: '2027-06-02T18:00:00.000+05:30',
    });

    const day = await occurrencesOf(id, '2027-06-02', '2027-06-03');
    expect(day).toEqual([
      expect.objectContaining({
        start: '2027-06-02T17:00:00.000+05:30',
        originalStart: '2027-06-02T10:00:00.000+05:30',
        moved: true,
      }),
    ]);
    // A moved occurrence can move again; it is still the same occurrence.
    const again = await request(app)
      .post(`/events/${id}/occurrences/move`)
      .set(user.auth)
      .send({ occurrence: '2027-06-02T17:00:00.000+05:30', startAt: '2027-06-02T19:00' });
    expect(again.body.exception.id).toBe(move.body.exception.id);
  });

  it('checks clashes for the new time, and others see the moved time', async () => {
    const id = await createDaily('Yoga', '2027-07-01T07:00', '2027-07-01T08:00');
    await request(app)
      .post('/events')
      .set(user.auth)
      .send({ title: 'Doctor', startAt: '2027-07-02T12:00', endAt: '2027-07-02T13:00' });

    const clash = await request(app)
      .post(`/events/${id}/occurrences/move`)
      .set(user.auth)
      .send({ occurrence: '2027-07-02', startAt: '2027-07-02T12:30' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.details.conflicts[0].title).toBe('Doctor');

    await request(app)
      .post(`/events/${id}/occurrences/move`)
      .set(user.auth)
      .send({ occurrence: '2027-07-02', startAt: '2027-07-02T15:00' });
    // 07:00 on that day is now free; 15:00 is not.
    const free = await request(app)
      .post('/events')
      .set(user.auth)
      .send({ title: 'Call', startAt: '2027-07-02T07:15' });
    expect(free.status).toBe(201);
    const busy = await request(app)
      .post('/events')
      .set(user.auth)
      .send({ title: 'Call 2', startAt: '2027-07-02T15:15' });
    expect(busy.status).toBe(409);
    expect(busy.body.error.details.conflicts[0]).toMatchObject({
      title: 'Yoga',
      start: '2027-07-02T15:00:00.000+05:30',
    });
  });

  it('moves the reminder with the occurrence and drops it when skipped', async () => {
    const tomorrow = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate();
    const id = await createDaily('Walk', `${tomorrow}T18:00`);
    const reminders = () =>
      prisma.reminder.findMany({
        where: { eventId: id, status: 'PENDING' },
        orderBy: { triggerAt: 'asc' },
      });
    const before = await reminders();
    expect(DateTime.fromJSDate(before[0]!.occurrenceAt).setZone('Asia/Kolkata').hour).toBe(18);

    await request(app)
      .post(`/events/${id}/occurrences/move`)
      .set(user.auth)
      .send({ occurrence: tomorrow, startAt: `${tomorrow}T20:00` });
    const moved = await reminders();
    expect(DateTime.fromJSDate(moved[0]!.occurrenceAt).setZone('Asia/Kolkata').hour).toBe(20);
    expect(moved).toHaveLength(before.length);

    await request(app)
      .post(`/events/${id}/occurrences/skip`)
      .set(user.auth)
      .send({ occurrence: tomorrow });
    expect(await reminders()).toHaveLength(before.length - 1);
  });

  it('clears exceptions when the series schedule changes', async () => {
    const id = await createDaily('Swim', '2027-08-01T06:00');
    await request(app)
      .post(`/events/${id}/occurrences/skip`)
      .set(user.auth)
      .send({ occurrence: '2027-08-03' });
    await request(app).patch(`/events/${id}`).set(user.auth).send({ title: 'Swimming' });
    expect(await prisma.eventException.count({ where: { eventId: id } })).toBe(1);
    await request(app)
      .patch(`/events/${id}`)
      .set(user.auth)
      .send({ startAt: '2027-08-01T07:00', allowConflicts: true });
    expect(await prisma.eventException.count({ where: { eventId: id } })).toBe(0);
  });

  it('rejects one-off events and dates without an occurrence', async () => {
    const single = await request(app)
      .post('/events')
      .set(user.auth)
      .send({ title: 'Once', startAt: '2027-09-01T10:00', allowConflicts: true });
    const notRecurring = await request(app)
      .post(`/events/${single.body.event.id}/occurrences/skip`)
      .set(user.auth)
      .send({ occurrence: '2027-09-01' });
    expect(notRecurring.status).toBe(400);
    expect(notRecurring.body.error.code).toBe('NOT_RECURRING');

    const weekly = await request(app).post('/events').set(user.auth).send({
      title: 'Weekly',
      startAt: '2027-09-06T10:00',
      rrule: 'FREQ=WEEKLY',
      allowConflicts: true,
    });
    const wrongDay = await request(app)
      .post(`/events/${weekly.body.event.id}/occurrences/skip`)
      .set(user.auth)
      .send({ occurrence: '2027-09-07' });
    expect(wrongDay.status).toBe(400);
  });

  it('is respected by the day plan and available to the assistant', async () => {
    const id = await createDaily('Meditation', '2027-10-01T09:00', '2027-10-01T09:30');
    script = (ctx) =>
      ctx.call === 0
        ? callTool('skip_occurrence', { eventId: id, occurrence: '2027-10-04' })
        : say('Skipped.');
    const res = await request(app)
      .post('/assistant/messages')
      .set(user.auth)
      .send({ text: 'Skip meditation on 4 October 2027' });
    expect(res.body.reply.actions[0]).toMatchObject({
      kind: 'event.occurrence_skipped',
      title: 'Meditation',
    });
    const plan = await request(app).get('/planning/day?date=2027-10-04').set(user.auth);
    expect(plan.body.plan.events.map((e: { title: string }) => e.title)).not.toContain(
      'Meditation',
    );
    const nextDay = await request(app).get('/planning/day?date=2027-10-05').set(user.auth);
    expect(nextDay.body.plan.events.map((e: { title: string }) => e.title)).toContain('Meditation');
  });
});
