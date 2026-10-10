import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  appName: z.string(),
  version: z.string(),
  time: z.string(),
  checks: z.object({
    database: z.enum(['ok', 'error']),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
