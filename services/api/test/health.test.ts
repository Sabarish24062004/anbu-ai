import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@anbu/shared';
import { buildTestApp } from './helpers';

describe('GET /health', () => {
  const { app, prisma } = buildTestApp();
  afterAll(() => prisma.$disconnect());

  it('reports ok when the database is reachable', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.checks.database).toBe('ok');
    expect(body.appName).toBeTruthy();
  });

  it('reports degraded with 503 when the database is unreachable', async () => {
    const broken = buildTestApp({
      databaseUrl: 'postgresql://nobody:wrong@127.0.0.1:1/none',
    });
    try {
      const res = await request(broken.app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.checks.database).toBe('error');
    } finally {
      await broken.prisma.$disconnect();
    }
  });

  it('returns a safe JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
