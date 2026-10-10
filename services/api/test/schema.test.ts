import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { createPrismaClient } from '../src/database/prisma';

const prisma = createPrismaClient(loadEnv().DATABASE_URL);
const email = `schema-test-${Date.now()}@example.test`;
let userId: string;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email, passwordHash: 'not-a-real-hash' } });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } }); // cascades to owned rows
  await prisma.$disconnect();
});

describe('database integrity constraints', () => {
  it('rejects a reminder that is not attached to anything', async () => {
    await expect(
      prisma.reminder.create({
        data: { userId, offsetMinutes: 15, occurrenceAt: new Date(), triggerAt: new Date() },
      }),
    ).rejects.toThrow(/Reminder_exactly_one_target/);
  });

  it('rejects an event that ends before it starts', async () => {
    await expect(
      prisma.event.create({
        data: {
          userId,
          title: 'Backwards',
          timezone: 'Asia/Kolkata',
          startAt: new Date('2026-10-11T01:30:00Z'),
          endAt: new Date('2026-10-11T01:00:00Z'),
        },
      }),
    ).rejects.toThrow(/Event_end_after_start/);
  });

  it('stores an event with a 15-minute default reminder and one reminder row', async () => {
    const startAt = new Date('2026-10-11T01:30:00Z'); // 07:00 Asia/Kolkata
    const event = await prisma.event.create({
      data: { userId, title: 'Exercise', timezone: 'Asia/Kolkata', startAt },
    });
    expect(event.reminderOffsets).toEqual([15]);

    const reminder = await prisma.reminder.create({
      data: {
        userId,
        eventId: event.id,
        offsetMinutes: 15,
        occurrenceAt: startAt,
        triggerAt: new Date('2026-10-11T01:15:00Z'),
      },
    });
    expect(reminder.status).toBe('PENDING');

    // The same occurrence/offset cannot be scheduled twice.
    await expect(
      prisma.reminder.create({
        data: {
          userId,
          eventId: event.id,
          offsetMinutes: 15,
          occurrenceAt: startAt,
          triggerAt: new Date('2026-10-11T01:15:00Z'),
        },
      }),
    ).rejects.toThrow(/Unique constraint/i);
  });
});
