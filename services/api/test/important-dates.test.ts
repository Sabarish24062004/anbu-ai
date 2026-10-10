import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextOccurrence } from '../src/modules/important-dates/important-dates.service';
import { buildTestApp, deleteTestUsers, registerUser } from './helpers';

const zone = 'Asia/Kolkata';
const at = (iso: string) => DateTime.fromISO(iso, { zone });
const birthday = (month: number, day: number, year: number | null = null) => ({
  month,
  day,
  year,
  recursAnnually: true,
  timezone: zone,
});

describe('nextOccurrence', () => {
  it('counts today as day 0 and reports the age turned', () => {
    const next = nextOccurrence(birthday(10, 10, 1990), at('2026-10-10T20:00'));
    expect(next).toMatchObject({ daysUntil: 0, yearsSince: 36 });
    expect(next?.date.toISODate()).toBe('2026-10-10');
  });

  it('rolls over the year end', () => {
    const next = nextOccurrence(birthday(1, 2), at('2026-12-30T08:00'));
    expect(next?.date.toISODate()).toBe('2027-01-02');
    expect(next?.daysUntil).toBe(3);
  });

  it('observes Feb 29 on Feb 28 in common years', () => {
    const next = nextOccurrence(birthday(2, 29, 2000), at('2027-01-01'));
    expect(next?.date.toISODate()).toBe('2027-02-28');
    expect(next?.yearsSince).toBe(27);
  });

  it('uses the date’s own timezone for "today"', () => {
    // 20:00 UTC on Oct 9 is already Oct 10 in India.
    const next = nextOccurrence(birthday(10, 10), DateTime.fromISO('2026-10-09T20:00Z'));
    expect(next?.daysUntil).toBe(0);
  });

  it('returns null for a one-off date that has passed', () => {
    const d = { ...birthday(5, 1, 2025), recursAnnually: false };
    expect(nextOccurrence(d, at('2026-01-01'))).toBeNull();
  });
});

describe('important dates API', () => {
  const { app, prisma } = buildTestApp();
  let user: Awaited<ReturnType<typeof registerUser>>;
  beforeAll(async () => {
    user = await registerUser(app);
  });
  afterAll(async () => {
    await deleteTestUsers(prisma);
    await prisma.$disconnect();
  });

  it('validates the day against the month, including on partial updates', async () => {
    const bad = await request(app)
      .post('/important-dates')
      .set(user.auth)
      .send({ title: 'x', type: 'CUSTOM', month: 4, day: 31 });
    expect(bad.status).toBe(400);

    const ok = await request(app)
      .post('/important-dates')
      .set(user.auth)
      .send({ title: 'Wedding anniversary', type: 'ANNIVERSARY', month: 4, day: 30 });
    expect(ok.status).toBe(201);
    expect(ok.body.importantDate).toMatchObject({ reminderOffsets: [1440, 0], timezone: zone });

    const patch = await request(app)
      .patch(`/important-dates/${ok.body.importantDate.id}`)
      .set(user.auth)
      .send({ day: 31 });
    expect(patch.status).toBe(400);
  });

  it('lists upcoming dates soonest first', async () => {
    const today = DateTime.now().setZone(zone);
    const inDays = (n: number) => today.plus({ days: n });
    const post = (title: string, d: DateTime) =>
      request(app)
        .post('/important-dates')
        .set(user.auth)
        .send({ title, type: 'BIRTHDAY', month: d.month, day: d.day, year: d.year - 30 });
    await post('Karthik', inDays(5));
    await post('Amma', inDays(1));
    await post('Far away', inDays(100));

    const res = await request(app).get('/important-dates/upcoming?days=30').set(user.auth);
    expect(res.status).toBe(200);
    const titles = res.body.upcoming.map(
      (u: { importantDate: { title: string } }) => u.importantDate.title,
    );
    expect(titles).toEqual(['Amma', 'Karthik']);
    expect(res.body.upcoming[0]).toMatchObject({ daysUntil: 1, yearsSince: 30 });
  });
});
