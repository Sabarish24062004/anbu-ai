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

const create = (body: Record<string, unknown>) =>
  request(app).post('/tasks').set(user.auth).send(body);
const complete = (id: string) => request(app).post(`/tasks/${id}/complete`).set(user.auth);

describe('tasks', () => {
  it('creates a task with a local due time and lists open tasks by due date', async () => {
    const later = await create({ title: 'Pay rent', dueAt: '2027-01-05T18:00', priority: 'HIGH' });
    const sooner = await create({ title: 'Buy milk', dueAt: '2027-01-02T09:00' });
    const undated = await create({ title: 'Read a book' });
    expect(later.status).toBe(201);
    expect(later.body.task.dueAt).toBe('2027-01-05T18:00:00.000+05:30');

    const list = await request(app).get('/tasks').set(user.auth);
    const ids = list.body.tasks.map((t: { id: string }) => t.id);
    expect(ids).toEqual([sooner.body.task.id, later.body.task.id, undated.body.task.id]);
  });

  it('requires a due date for recurring tasks', async () => {
    const res = await create({ title: 'Water plants', rrule: 'FREQ=DAILY' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('rrule');
  });

  it('moves a recurring task to its next due date until its occurrences run out', async () => {
    const t = await create({
      title: 'Weekly report',
      dueAt: '2027-01-08T17:00',
      rrule: 'FREQ=WEEKLY;COUNT=2',
    });
    const first = await complete(t.body.task.id);
    expect(first.body).toMatchObject({
      rescheduled: true,
      task: {
        status: 'PENDING',
        dueAt: '2027-01-15T17:00:00.000+05:30',
        rrule: 'FREQ=WEEKLY;COUNT=1',
      },
    });
    const second = await complete(t.body.task.id);
    expect(second.body).toMatchObject({ rescheduled: false, task: { status: 'COMPLETED' } });
  });

  it('enforces dependencies and rejects cycles', async () => {
    const a = await create({ title: 'Book hall' });
    const b = await create({ title: 'Send invitations', blockedById: a.body.task.id });

    const blocked = await complete(b.body.task.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('TASK_BLOCKED');

    const cycle = await request(app)
      .patch(`/tasks/${a.body.task.id}`)
      .set(user.auth)
      .send({ blockedById: b.body.task.id });
    expect(cycle.status).toBe(400);

    await complete(a.body.task.id);
    expect((await complete(b.body.task.id)).body.task.status).toBe('COMPLETED');
  });

  it('cannot depend on another user’s task', async () => {
    const other = await registerUser(app);
    const theirs = await request(app).post('/tasks').set(other.auth).send({ title: 'Theirs' });
    const res = await create({ title: 'Mine', blockedById: theirs.body.task.id });
    expect(res.status).toBe(400);
  });
});
