import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, deleteTestUsers, registerUser, TEST_PASSWORD } from './helpers';

const { app, prisma } = buildTestApp();
let user: Awaited<ReturnType<typeof registerUser>>;

beforeAll(async () => {
  user = await registerUser(app, { displayName: 'Anbu Tester' });
});
afterAll(async () => {
  await deleteTestUsers(prisma);
  await prisma.$disconnect();
});

describe('registration and login', () => {
  it('stores only a scrypt hash and creates default preferences', async () => {
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      include: { preference: true },
    });
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain(TEST_PASSWORD);
    expect(row.preference?.defaultReminderLeadMinutes).toBe(15);
  });

  it('rejects a duplicate email regardless of case', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects unknown fields and short passwords', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'x@example.test', password: 'short', isAdmin: true });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain('password');
  });

  it('logs in with the right password and gives one error for wrong password or email', async () => {
    const ok = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.tokens.accessToken).toBeTruthy();
    expect(ok.body.user).not.toHaveProperty('passwordHash');

    const wrong = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: 'nope-nope' });
    const unknown = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.test', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });
});

describe('access tokens', () => {
  it('protects user routes', async () => {
    expect((await request(app).get('/me')).status).toBe(401);
    const tampered = user.tokens.accessToken.slice(0, -2) + 'xx';
    const res = await request(app).get('/me').set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  it('returns and updates the profile and preferences', async () => {
    const me = await request(app).get('/me').set(user.auth);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({
      displayName: 'Anbu Tester',
      timezone: 'Asia/Kolkata',
      language: 'ta',
    });

    const badTz = await request(app).patch('/me').set(user.auth).send({ timezone: 'Chennai/Home' });
    expect(badTz.status).toBe(400);

    const updated = await request(app).patch('/me').set(user.auth).send({ language: 'en' });
    expect(updated.body.user.language).toBe('en');

    const prefs = await request(app)
      .patch('/me/preferences')
      .set(user.auth)
      .send({ defaultReminderLeadMinutes: 30, workDays: [5, 1, 1] });
    expect(prefs.status).toBe(200);
    expect(prefs.body.preferences).toMatchObject({
      defaultReminderLeadMinutes: 30,
      workDays: [1, 5],
    });
  });
});

describe('refresh tokens', () => {
  it('rotate on each use, and replaying an old one revokes the whole family', async () => {
    const { tokens } = await registerUser(app);
    const first = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.tokens.refreshToken).not.toBe(tokens.refreshToken);

    // Replaying the consumed token looks like theft: it fails and kills the newer token too.
    const replay = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(replay.status).toBe(401);
    const next = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: first.body.tokens.refreshToken });
    expect(next.status).toBe(401);
  });

  it('cannot be used after logout', async () => {
    const { tokens } = await registerUser(app);
    const out = await request(app).post('/auth/logout').send({ refreshToken: tokens.refreshToken });
    expect(out.status).toBe(204);
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });
});
