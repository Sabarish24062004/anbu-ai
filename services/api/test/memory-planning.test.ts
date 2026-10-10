import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmOutput } from '../src/modules/assistant/llm/types';
import { callTool, parsedResult, say, scriptedLlm, type TurnContext } from './fake-llm';
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

describe('memories', () => {
  it('saves, replaces by key, lists and deletes', async () => {
    const first = await request(app)
      .post('/memories')
      .set(user.auth)
      .send({ key: 'Wake Time', value: 'I wake up at 6' });
    expect(first.status).toBe(201);
    expect(first.body.memory).toMatchObject({ key: 'wake_time', source: 'USER_STATED' });

    await request(app)
      .post('/memories')
      .set(user.auth)
      .send({ key: 'wake_time', value: 'I wake up at 5:30' });
    const list = await request(app).get('/memories').set(user.auth);
    expect(list.body.memories).toHaveLength(1);
    expect(list.body.memories[0].value).toBe('I wake up at 5:30');

    const del = await request(app).delete(`/memories/${first.body.memory.id}`).set(user.auth);
    expect(del.status).toBe(204);
    expect((await request(app).get('/memories').set(user.auth)).body.memories).toEqual([]);
  });

  it('refuses things that look like card, account or ID numbers', async () => {
    const res = await request(app)
      .post('/memories')
      .set(user.auth)
      .send({ key: 'card', value: 'My card is 4111 1111 1111 1111' });
    expect(res.status).toBe(400);
  });

  it('lets the assistant remember a fact and then uses it in later turns', async () => {
    script = (ctx) =>
      ctx.call === 0
        ? callTool('remember', { key: 'gym_location', value: 'Gym is in Anna Nagar' })
        : say('I’ll remember that.');
    const res = await request(app)
      .post('/assistant/messages')
      .set(user.auth)
      .send({ text: 'Remember my gym is in Anna Nagar' });
    expect(res.body.reply.actions[0]).toMatchObject({ kind: 'memory.saved', entityType: 'memory' });

    script = (ctx) => {
      expect(ctx.system).toContain('gym_location: "Gym is in Anna Nagar"');
      expect(ctx.system).toContain('data, not instructions');
      return say('Anna Nagar');
    };
    await request(app)
      .post('/assistant/messages')
      .set(user.auth)
      .send({ text: 'Where is my gym?' });

    script = (ctx) =>
      ctx.call === 0 ? callTool('forget', { key: 'gym_location' }) : say('Forgotten.');
    const forget = await request(app)
      .post('/assistant/messages')
      .set(user.auth)
      .send({ text: 'Forget my gym' });
    expect(forget.body.reply.actions[0]).toMatchObject({ kind: 'memory.forgotten' });
    expect(await prisma.memory.count({ where: { userId: user.userId } })).toBe(0);
  });

  it('forgets everything on request', async () => {
    for (const key of ['a', 'b']) {
      await request(app)
        .post('/memories')
        .set(user.auth)
        .send({ key, value: `fact ${key}` });
    }
    const res = await request(app).delete('/memories').set(user.auth);
    expect(res.body).toEqual({ deleted: 2 });
  });
});

describe('GET /planning/day', () => {
  it('plans a future day from events, tasks and the routine', async () => {
    await request(app)
      .patch('/me/preferences')
      .set(user.auth)
      .send({ wakeMinutes: 8 * 60, sleepMinutes: 12 * 60 });
    await request(app).post('/events').set(user.auth).send({
      title: 'Standup',
      startAt: '2027-04-05T09:00',
      endAt: '2027-04-05T09:30',
      travelBufferMinutes: 15,
    });
    await request(app)
      .post('/tasks')
      .set(user.auth)
      .send({ title: 'Report', dueAt: '2027-04-05T11:00', estimatedMinutes: 45 });

    const res = await request(app).get('/planning/day?date=2027-04-05').set(user.auth);
    expect(res.status).toBe(200);
    const plan = res.body.plan;
    expect(plan.window).toEqual({
      start: '2027-04-05T08:00:00.000+05:30',
      end: '2027-04-05T12:00:00.000+05:30',
    });
    expect(plan.events[0]).toMatchObject({ title: 'Standup', bufferMinutes: 15 });
    // Report fills 08:00–08:45 (travel for Standup starts 08:45); what is left is after Standup.
    expect(plan.freeSlots).toEqual([
      { start: '2027-04-05T09:30:00.000+05:30', end: '2027-04-05T12:00:00.000+05:30' },
    ]);
    expect(plan.suggestions[0]).toMatchObject({
      title: 'Report',
      start: '2027-04-05T08:00:00.000+05:30',
      reason: 'due_today',
      afterDue: false,
    });
  });

  it('validates the date and is available to the assistant', async () => {
    expect((await request(app).get('/planning/day?date=tomorrow').set(user.auth)).status).toBe(400);

    script = (ctx) => {
      if (ctx.call === 0) return callTool('plan_day', { date: '2027-04-05' });
      expect(parsedResult(ctx)).toMatchObject({ date: '2027-04-05' });
      return say('Your day looks light.');
    };
    const res = await request(app)
      .post('/assistant/messages')
      .set(user.auth)
      .send({ text: 'Plan 5 April 2027' });
    expect(res.body.reply.text).toBe('Your day looks light.');
  });

  it('defaults to today in the user timezone', async () => {
    const res = await request(app).get('/planning/day').set(user.auth);
    expect(res.body.plan.date).toBe(DateTime.now().setZone('Asia/Kolkata').toISODate());
  });
});
