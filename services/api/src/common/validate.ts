import type { z } from 'zod';
import { AppError } from './errors';

/** Parses untrusted input, turning schema failures into a 400 that names each bad field. */
export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', details);
  }
  return result.data;
}

export function invalidField(path: string, message: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path, message }]);
}
