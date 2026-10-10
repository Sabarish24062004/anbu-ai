import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, deleteTestUsers, registerUser } from './helpers';

const { app, prisma } = buildTestApp();
let user: Awaited<ReturnType<typeof registerUser>>;

beforeAll(async () => {
  user = await registerUser(app);
});
afterAll(async () => {
  await deleteTestUsers(prisma);
  await prisma.$disconnect();
});

// Each test uses its own dates so events from other tests cannot cause conflicts.
const create = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  request(app).post('/events').set(user.auth).set(headers).send(body);

const listRange = (from: string, to: string, auth = user.auth) =>
  request(app).get('/events').query({ from, to }).set(auth);

describe('creating events', () => {
  it('interprets a time without an offset in the user timezone', async () => {
    const res = await create({
      title: 'Exercise',
      startAt: '2027-01-04T07:00',
      endAt: '2027-01-04T08:00',
    });
    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({
      startAt: '2027-01-04T07:00:00.000+05:30',
      endAt: '2027-01-04T08:00:00.000+05:30',
      timezone: 'Asia/Kolkata',
      reminderOffsets: [15],
      status: 'SCHEDULED',
    });
    expect(res.body.conflicts).toEqual([]);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: res.body.event.id } });
    expect(row.startAt.toISOString()).toBe('2027-01-04T01:30:00.000Z');
  });

  it('honours an explicit offset and timezone', async () => {
    const res = await create({
      title: 'Call',
      startAt: '2027-01-05T09:00Z',
      timezone: 'Europe/London',
    });
    expect(res.body.event.startAt).toBe('2027-01-05T09:00:00.000+00:00');
  });

  it('stores all-day events as whole local days', async () => {
    const res = await create({
      title: 'Pongal',
      startAt: '2027-01-14',
      endAt: '2027-01-15',
      allDay: true,
    });
    expect(res.body.event.startAt).toBe('2027-01-14T00:00:00.000+05:30');
    expect(res.body.event.endAt).toBe('2027-01-16T00:00:00.000+05:30');
  });

  it('reports field errors', async () => {
    const res = await create({ title: '', startAt: '2027-01-04T07:00', rrule: 'FREQ=SECONDLY' });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['title', 'rrule']));

    const backwards = await create({
      title: 'x',
      startAt: '2027-01-04T07:00',
      endAt: '2027-01-04T06:00',
    });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.details[0].path).toBe('endAt');
  });
});

describe('conflicts', () => {
  it('blocks an overlapping event until the user confirms', async () => {
    const first = await create({
      title: 'Doctor',
      startAt: '2027-02-01T10:00',
      endAt: '2027-02-01T11:00',
    });
    const clash = await create({
      title: 'Meeting',
      startAt: '2027-02-01T10:30',
      endAt: '2027-02-01T11:30',
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect(clash.body.error.details.conflicts[0]).toMatchObject({
      eventId: first.body.event.id,
      title: 'Doctor',
      start: '2027-02-01T10:00:00.000+05:30',
    });
    expect(await prisma.event.count({ where: { userId: user.userId, title: 'Meeting' } })).toBe(0);

    const confirmed = await create({
      title: 'Meeting',
      startAt: '2027-02-01T10:30',
      endAt: '2027-02-01T11:30',
      allowConflicts: true,
    });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.conflicts).toHaveLength(1);
  });

  it('allows back-to-back events but counts travel time', async () => {
    await create({ title: 'Class', startAt: '2027-02-02T10:00', endAt: '2027-02-02T11:00' });
    const adjacent = await create({
      title: 'Lunch',
      startAt: '2027-02-02T11:00',
      endAt: '2027-02-02T12:00',
    });
    expect(adjacent.status).toBe(201);

    const needsTravel = await create({
      title: 'Bank',
      startAt: '2027-02-02T12:15',
      travelBufferMinutes: 30,
    });
    expect(needsTravel.status).toBe(409);
    expect(needsTravel.body.error.details.conflicts[0].title).toBe('Lunch');
  });

  it('finds clashes with future occurrences of recurring events', async () => {
    await create({
      title: 'Gym',
      startAt: '2027-03-01T07:00',
      endAt: '2027-03-01T08:00',
      rrule: 'FREQ=DAILY',
    });
    const res = await create({ title: 'Flight', startAt: '2027-03-10T07:30' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.conflicts[0]).toMatchObject({
      title: 'Gym',
      start: '2027-03-10T07:00:00.000+05:30',
    });
  });

  it('ignores cancelled and all-day events', async () => {
    const e = await create({
      title: 'Old plan',
      startAt: '2027-04-01T09:00',
      endAt: '2027-04-01T10:00',
    });
    await request(app).post(`/events/${e.body.event.id}/cancel`).set(user.auth);
    await create({ title: 'Holiday', startAt: '2027-04-01', allDay: true });
    const res = await create({
      title: 'New plan',
      startAt: '2027-04-01T09:00',
      endAt: '2027-04-01T10:00',
    });
    expect(res.status).toBe(201);
  });
});

describe('listing, updating and status changes', () => {
  it('expands recurring events into occurrences within the range', async () => {
    await create({ title: 'Medicine', startAt: '2027-05-03T21:00', rrule: 'FREQ=DAILY;COUNT=3' });
    const res = await listRange('2027-05-01', '2027-05-10');
    expect(res.status).toBe(200);
    const starts = res.body.occurrences
      .filter((o: { event: { title: string } }) => o.event.title === 'Medicine')
      .map((o: { start: string }) => o.start);
    expect(starts).toEqual([
      '2027-05-03T21:00:00.000+05:30',
      '2027-05-04T21:00:00.000+05:30',
      '2027-05-05T21:00:00.000+05:30',
    ]);
  });

  it('rejects ranges that are backwards or too long', async () => {
    expect((await listRange('2027-05-10', '2027-05-01')).status).toBe(400);
    expect((await listRange('2027-01-01', '2029-01-01')).status).toBe(400);
  });

  it('keeps the duration when only the start moves', async () => {
    const e = await create({
      title: 'Review',
      startAt: '2027-06-01T14:00',
      endAt: '2027-06-01T15:30',
    });
    const res = await request(app)
      .patch(`/events/${e.body.event.id}`)
      .set(user.auth)
      .send({ startAt: '2027-06-02T16:00' });
    expect(res.status).toBe(200);
    expect(res.body.event.endAt).toBe('2027-06-02T17:30:00.000+05:30');
  });

  it('cancels idempotently and refuses to complete or edit a cancelled event', async () => {
    const e = await create({ title: 'Dentist', startAt: '2027-06-10T10:00' });
    const id = e.body.event.id;
    const first = await request(app).post(`/events/${id}/cancel`).set(user.auth);
    const again = await request(app).post(`/events/${id}/cancel`).set(user.auth);
    expect(first.body.event.status).toBe('CANCELLED');
    expect(again.status).toBe(200);
    expect((await request(app).post(`/events/${id}/complete`).set(user.auth)).status).toBe(409);
    const edit = await request(app).patch(`/events/${id}`).set(user.auth).send({ title: 'x' });
    expect(edit.status).toBe(409);
  });

  it('records an audit trail without personal content', async () => {
    const e = await create({ title: 'Secret appointment', startAt: '2027-06-20T10:00' });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: e.body.event.id } });
    expect(log.action).toBe('event.create');
    expect(JSON.stringify(log.metadata)).not.toContain('Secret');
  });
});

describe('ownership', () => {
  it('never exposes or changes events that belong to another user', async () => {
    const e = await create({ title: 'Mine', startAt: '2027-07-01T10:00' });
    const other = await registerUser(app);
    const id = e.body.event.id;
    expect((await request(app).get(`/events/${id}`).set(other.auth)).status).toBe(404);
    expect((await request(app).delete(`/events/${id}`).set(other.auth)).status).toBe(404);
    const list = await listRange('2027-07-01', '2027-07-02', other.auth);
    expect(list.body.occurrences).toEqual([]);
    expect((await request(app).get('/events/not-a-uuid').set(user.auth)).status).toBe(404);
  });
});

describe('idempotency keys', () => {
  it('applies a retried create once and replays the original response', async () => {
    const key = `test-${randomUUID()}`;
    const body = { title: 'Voice command', startAt: '2027-08-01T10:00' };
    const first = await create(body, { 'Idempotency-Key': key });
    const retry = await create(body, { 'Idempotency-Key': key });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.event.id).toBe(first.body.event.id);
    const count = await prisma.event.count({
      where: { userId: user.userId, title: 'Voice command' },
    });
    expect(count).toBe(1);

    const different = await create({ ...body, title: 'Other' }, { 'Idempotency-Key': key });
    expect(different.status).toBe(422);
  });

  it('replays stored error responses too', async () => {
    const key = `test-${randomUUID()}`;
    const bad = { title: 'x', startAt: 'tomorrow' };
    const first = await create(bad, { 'Idempotency-Key': key });
    const retry = await create(bad, { 'Idempotency-Key': key });
    expect(first.status).toBe(400);
    expect(retry.status).toBe(400);
    expect(retry.headers['idempotent-replayed']).toBe('true');
  });
});
