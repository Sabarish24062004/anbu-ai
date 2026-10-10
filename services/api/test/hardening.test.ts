import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createLogger } from '../src/common/logger';
import { loadEnv } from '../src/config/env';
import { runMaintenance } from '../src/modules/reminders/maintenance';
import { createExpoPushChannel, pushContent } from '../src/modules/reminders/push';
import { buildTestApp, deleteTestUsers, registerUser, TEST_PASSWORD } from './helpers';

const { app, prisma } = buildTestApp();
const logger = createLogger('silent');
let user: Awaited<ReturnType<typeof registerUser>>;

beforeAll(async () => {
  user = await registerUser(app);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await deleteTestUsers(prisma);
  await prisma.$disconnect();
});

describe('rate limits', () => {
  it('stops password guessing for an account after 10 failures, and says so', async () => {
    const limited = createApp({
      env: { ...loadEnv(), RATE_LIMITS_ENABLED: true },
      prisma,
      logger,
    });
    const attempt = () =>
      request(limited).post('/auth/login').send({ email: user.email, password: 'wrong-guess' });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['ratelimit']).toBeDefined();
    // Even the right password waits until the window passes.
    const right = await request(limited)
      .post('/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(right.status).toBe(429);
  });
});

describe('exposure', () => {
  it('rejects a large voice upload before reading it when not signed in', async () => {
    const big = 'A'.repeat(2_000_000);
    const res = await request(app)
      .post('/assistant/voice')
      .send({ audio: big, mimeType: 'audio/m4a' });
    expect(res.status).toBe(401);
  });

  it('can close registration for a personal server', async () => {
    const closed = createApp({ env: { ...loadEnv(), REGISTRATION_OPEN: false }, prisma, logger });
    const res = await request(closed)
      .post('/auth/register')
      .send({ email: 'someone@example.test', password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REGISTRATION_CLOSED');
    // Existing users can still sign in.
    const login = await request(closed)
      .post('/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
  });
});

describe('account', () => {
  it('changes the password, signs out other sessions and keeps this one', async () => {
    const u = await registerUser(app);
    const wrong = await request(app)
      .post('/me/password')
      .set(u.auth)
      .send({ currentPassword: 'nope', newPassword: 'a brand new password' });
    expect(wrong.status).toBe(403);

    const res = await request(app)
      .post('/me/password')
      .set(u.auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a brand new password' });
    expect(res.status).toBe(200);
    expect(res.body.tokens.refreshToken).toBeTruthy();

    const old = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: u.tokens.refreshToken });
    expect(old.status).toBe(401);
    const login = await request(app)
      .post('/auth/login')
      .send({ email: u.email, password: 'a brand new password' });
    expect(login.status).toBe(200);
  });

  it('exports everything except secrets', async () => {
    await request(app).post('/tasks').set(user.auth).send({ title: 'Export me' });
    await request(app).post('/memories').set(user.auth).send({ key: 'k', value: 'v' });
    const res = await request(app).get('/me/export').set(user.auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="anbu-ai-export-/);
    expect(res.body.tasks.map((t: { title: string }) => t.title)).toContain('Export me');
    expect(res.body.memories[0]).toMatchObject({ key: 'k', value: 'v' });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('tokenHash');
  });

  it('deletes the account and all its data after the password is confirmed', async () => {
    const u = await registerUser(app);
    await request(app).post('/tasks').set(u.auth).send({ title: 'Gone soon' });
    expect((await request(app).delete('/me').set(u.auth).send({ password: 'nope' })).status).toBe(
      403,
    );

    const res = await request(app).delete('/me').set(u.auth).send({ password: TEST_PASSWORD });
    expect(res.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: u.userId } })).toBeNull();
    expect(await prisma.task.count({ where: { userId: u.userId } })).toBe(0);
    // A still-valid access token no longer works.
    expect((await request(app).get('/me').set(u.auth)).status).toBe(401);
    const log = await prisma.auditLog.findFirst({
      where: { action: 'user.delete', entityId: u.userId },
    });
    expect(log?.userId).toBeNull(); // kept, but detached from the deleted user
  });
});

describe('maintenance', () => {
  it('removes expired keys and tokens and old reminder history only', async () => {
    const past = new Date(Date.now() - 1000);
    const old = new Date(Date.now() - 100 * 86_400_000);
    await prisma.idempotencyKey.create({
      data: { userId: user.userId, key: 'old-key-123', requestHash: 'x', expiresAt: past },
    });
    const event = await prisma.event.create({
      data: { userId: user.userId, title: 'Old', timezone: 'Asia/Kolkata', startAt: old },
    });
    await prisma.reminder.create({
      data: {
        userId: user.userId,
        eventId: event.id,
        offsetMinutes: 15,
        occurrenceAt: old,
        triggerAt: old,
        status: 'SENT',
      },
    });
    const removed = await runMaintenance(prisma);
    expect(removed.idempotencyKeys).toBeGreaterThanOrEqual(1);
    expect(removed.reminders).toBeGreaterThanOrEqual(1);
    expect(await prisma.reminder.count({ where: { eventId: event.id } })).toBe(0);
    // Live refresh tokens survive.
    expect(await prisma.refreshToken.count({ where: { userId: user.userId } })).toBeGreaterThan(0);
  });
});

describe('remote push', () => {
  async function dueReminder() {
    const event = await prisma.event.create({
      data: {
        userId: user.userId,
        title: 'Push test',
        timezone: 'Asia/Kolkata',
        startAt: new Date('2027-01-04T04:30:00Z'), // 10:00 IST
      },
    });
    return prisma.reminder.create({
      data: {
        userId: user.userId,
        eventId: event.id,
        offsetMinutes: 15,
        occurrenceAt: event.startAt,
        triggerAt: new Date('2027-01-04T04:15:00Z'),
      },
    });
  }

  it('registers a device and validates the token', async () => {
    const bad = await request(app)
      .post('/devices')
      .set(user.auth)
      .send({ platform: 'ANDROID', pushToken: 'not-a-token' });
    expect(bad.status).toBe(400);
    const ok = await request(app)
      .post('/devices')
      .set(user.auth)
      .send({ platform: 'ANDROID', pushToken: 'ExponentPushToken[abc123]' });
    expect(ok.status).toBe(201);
  });

  it('writes the message in the user’s language', async () => {
    const reminder = await dueReminder();
    const content = await pushContent(prisma, reminder);
    expect(content.title).toBe('Push test');
    expect(content.body).toMatch(/10:00/);
    expect(content.body).toContain('தொடங்கும்'); // the test user's language is Tamil
    expect(content.path).toMatch(/^\/event\//);
  });

  it('sends to registered devices and retires tokens Expo no longer knows', async () => {
    await request(app)
      .post('/devices')
      .set(user.auth)
      .send({ platform: 'IOS', pushToken: 'ExponentPushToken[gone456]' });
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const messages = JSON.parse(String(init.body)) as { to: string }[];
      return new Response(
        JSON.stringify({
          data: messages.map((m) =>
            m.to.includes('gone')
              ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
              : { status: 'ok', id: 'ticket' },
          ),
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const channel = createExpoPushChannel({ prisma, logger });
    expect(await channel.deliver(await dueReminder())).toBe('delivered');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body[0]).toMatchObject({ channelId: 'reminders', priority: 'high', sound: 'default' });
    const gone = await prisma.notificationDevice.findUniqueOrThrow({
      where: { pushToken: 'ExponentPushToken[gone456]' },
    });
    expect(gone.revokedAt).not.toBeNull();
  });

  it('skips users with no device and retries on server errors', async () => {
    const other = await registerUser(app);
    const event = await prisma.event.create({
      data: { userId: other.userId, title: 'x', timezone: 'Asia/Kolkata', startAt: new Date() },
    });
    const reminder = await prisma.reminder.create({
      data: {
        userId: other.userId,
        eventId: event.id,
        offsetMinutes: 0,
        occurrenceAt: event.startAt,
        triggerAt: event.startAt,
      },
    });
    const channel = createExpoPushChannel({ prisma, logger });
    expect(await channel.deliver(reminder)).toBe('skipped');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(channel.deliver(await dueReminder())).rejects.toThrow(/503/);
  });
});
