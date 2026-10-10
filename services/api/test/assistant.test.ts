import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LlmOutput } from '../src/modules/assistant/llm/types';
import { LlmError } from '../src/modules/assistant/llm/types';
import { callTool, parsedResult, say, scriptedLlm, type TurnContext } from './fake-llm';
import { buildTestApp, deleteTestUsers, registerUser } from './helpers';

// One app whose fake model runs whichever script the current test sets.
let script: (ctx: TurnContext) => LlmOutput | Promise<LlmOutput> = () => say('hi');
const fake = scriptedLlm((ctx) => script(ctx));
const { app, prisma } = buildTestApp({ llm: fake.provider });
let user: Awaited<ReturnType<typeof registerUser>>;

beforeAll(async () => {
  user = await registerUser(app);
});
beforeEach(() => {
  fake.calls.length = 0;
});
afterAll(async () => {
  await deleteTestUsers(prisma);
  await prisma.$disconnect();
});

const send = (text: string, conversationId?: string, auth = user.auth) =>
  request(app).post('/assistant/messages').set(auth).send({ text, conversationId });

const eventsTitled = (title: string, userId = user.userId) =>
  prisma.event.findMany({ where: { userId, title } });

describe('availability', () => {
  it('reports 503 and stores nothing when no model is configured', async () => {
    const plain = buildTestApp();
    try {
      const status = await request(plain.app).get('/assistant/status').set(user.auth);
      expect(status.body).toEqual({ available: false, voice: false });
      const res = await request(plain.app)
        .post('/assistant/messages')
        .set(user.auth)
        .send({ text: 'hello' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('ASSISTANT_UNAVAILABLE');
    } finally {
      await plain.prisma.$disconnect();
    }
  });
});

describe('tool use', () => {
  it('creates an event through a tool and replies from the real result', async () => {
    script = (ctx) => {
      if (ctx.call === 0) {
        expect(ctx.system).toContain('Asia/Kolkata');
        return callTool('create_event', { title: 'Gym', startAt: '2027-05-10T07:00', endAt: null });
      }
      expect(parsedResult(ctx)).toMatchObject({ status: 'created' });
      return say('Added Gym for 7 am on 10 May.');
    };
    const res = await send('Add gym on 10 May 2027 at 7am');
    expect(res.status).toBe(200);
    expect(res.body.reply.text).toBe('Added Gym for 7 am on 10 May.');
    expect(res.body.reply.actions).toEqual([
      expect.objectContaining({ kind: 'event.created', title: 'Gym' }),
    ]);
    const [event] = await eventsTitled('Gym');
    expect(event?.startAt.toISOString()).toBe('2027-05-10T01:30:00.000Z');

    const latest = await request(app).get('/assistant/conversations/latest').set(user.auth);
    expect(latest.body.conversation.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('carries the conversation history into the next turn', async () => {
    script = () => say('first');
    const first = await send('Remember this turn');
    script = (ctx) => {
      expect(ctx.history).toEqual([
        { role: 'user', text: 'Remember this turn' },
        { role: 'assistant', text: 'first' },
      ]);
      return say('second');
    };
    const second = await send('And this one', first.body.conversationId);
    expect(second.body.reply.text).toBe('second');
  });

  it('returns validation errors to the model instead of saving bad data', async () => {
    script = (ctx) => {
      if (ctx.call === 0) return callTool('create_event', { title: 'X', startAt: 'tomorrow' });
      expect(ctx.results[0]?.isError).toBe(true);
      expect(parsedResult(ctx)['error']).toBe('VALIDATION_ERROR');
      return say('What time tomorrow?');
    };
    const res = await send('Add X tomorrow');
    expect(res.body.reply.text).toBe('What time tomorrow?');
    expect(res.body.reply.actions).toEqual([]);
    expect(await eventsTitled('X')).toHaveLength(0);
  });

  it('rejects unknown tools and ids that belong to someone else', async () => {
    const other = await registerUser(app);
    const theirs = await request(app)
      .post('/events')
      .set(other.auth)
      .send({ title: 'Their event', startAt: '2027-06-01T10:00' });
    script = (ctx) => {
      if (ctx.call === 0) {
        return {
          text: null,
          toolCalls: [
            { id: 'a', name: 'drop_database', args: {} },
            {
              id: 'b',
              name: 'update_event',
              args: { eventId: theirs.body.event.id, title: 'Hacked' },
            },
          ],
        };
      }
      expect(parsedResult(ctx, 0)['error']).toBe('UNKNOWN_TOOL');
      expect(parsedResult(ctx, 1)['error']).toBe('NOT_FOUND');
      return say('I could not find that.');
    };
    await send('Rename event');
    expect(await eventsTitled('Their event', other.userId)).toHaveLength(1);
  });

  it('stops a model that keeps calling tools', async () => {
    script = () => callTool('list_tasks', {});
    const res = await send('loop forever');
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(6);
    expect(res.body.reply.actions).toEqual([]);
  });
});

describe('confirmations', () => {
  it('asks before saving a clashing event and saves it when the user says yes', async () => {
    await request(app)
      .post('/events')
      .set(user.auth)
      .send({ title: 'Doctor', startAt: '2027-07-01T10:00', endAt: '2027-07-01T11:00' });

    script = (ctx) =>
      ctx.call === 0
        ? callTool('create_event', { title: 'Meeting', startAt: '2027-07-01T10:30' })
        : (expect(parsedResult(ctx)['status']).toBe('needs_confirmation'),
          say('That clashes with Doctor. Add anyway?'));
    const ask = await send('Meeting on 1 July 2027 at 10:30');
    expect(ask.body.pendingAction).toMatchObject({ kind: 'create_event' });
    expect(ask.body.pendingAction.conflicts[0].title).toBe('Doctor');
    expect(await eventsTitled('Meeting')).toHaveLength(0);

    script = (ctx) => {
      if (ctx.call === 0) {
        expect(ctx.tools.map((t) => t.name)).toContain('confirm_pending_action');
        expect(ctx.system).toContain('Waiting for confirmation');
        return callTool('confirm_pending_action', {});
      }
      return say('சேர்த்துவிட்டேன்.');
    };
    const yes = await send('ஆமாம்', ask.body.conversationId);
    expect(yes.body.reply.actions[0]).toMatchObject({ kind: 'event.created', title: 'Meeting' });
    expect(yes.body.reply.language).toBe('ta');
    expect(yes.body.pendingAction).toBeNull();
    expect(await eventsTitled('Meeting')).toHaveLength(1);
  });

  it('cancels only after the confirm button, and only once', async () => {
    const created = await request(app)
      .post('/events')
      .set(user.auth)
      .send({ title: 'Haircut', startAt: '2027-08-01T16:00' });
    const id = created.body.event.id;
    script = (ctx) =>
      ctx.call === 0 ? callTool('cancel_event', { eventId: id }) : say('Cancel Haircut?');
    const ask = await send('cancel my haircut');
    expect((await prisma.event.findUniqueOrThrow({ where: { id } })).status).toBe('SCHEDULED');

    const base = `/assistant/conversations/${ask.body.conversationId}/pending/${ask.body.pendingAction.id}`;
    const confirm = await request(app).post(`${base}/confirm`).set(user.auth);
    expect(confirm.status).toBe(200);
    expect(confirm.body.reply.actions[0]).toMatchObject({ kind: 'event.cancelled' });
    expect((await prisma.event.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');

    const again = await request(app).post(`${base}/confirm`).set(user.auth);
    expect(again.body.reply.actions).toEqual([]);
    expect(again.body.reply.text).toMatch(/expired/i);
  });

  it('leaves everything unchanged when the user declines', async () => {
    const created = await request(app)
      .post('/events')
      .set(user.auth)
      .send({ title: 'Swim', startAt: '2027-08-02T06:00' });
    script = (ctx) =>
      ctx.call === 0
        ? callTool('cancel_event', { eventId: created.body.event.id })
        : say('Cancel Swim?');
    const ask = await send('cancel swim');
    const base = `/assistant/conversations/${ask.body.conversationId}/pending/${ask.body.pendingAction.id}`;
    const decline = await request(app).post(`${base}/decline`).set(user.auth);
    expect(decline.body.reply.text).toMatch(/left it/);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: created.body.event.id } });
    expect(event.status).toBe('SCHEDULED');
  });
});

describe('model failures', () => {
  it('reports what was already done when the model fails mid-turn', async () => {
    script = (ctx) => {
      if (ctx.call === 0) return callTool('create_task', { title: 'பால் வாங்கு' });
      throw new LlmError('boom', 'unavailable');
    };
    const res = await send('பால் வாங்க நினைவூட்டு');
    expect(res.status).toBe(200);
    expect(res.body.reply.actions[0]).toMatchObject({ kind: 'task.created' });
    expect(res.body.reply.text).toContain('பால் வாங்கு');
    expect(res.body.reply.text).toContain('நான் செய்தவை'); // Tamil fallback wording
  });

  it('returns 503 and stores nothing when the model fails before doing anything', async () => {
    const before = await prisma.conversationMessage.count({ where: { userId: user.userId } });
    script = () => {
      throw new LlmError('slow down', 'rate_limited');
    };
    const res = await send('hello?');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ASSISTANT_BUSY');
    expect(await prisma.conversationMessage.count({ where: { userId: user.userId } })).toBe(before);
  });
});
