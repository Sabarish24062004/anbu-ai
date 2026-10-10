import { z } from 'zod';
import { notFound } from './errors';

/** Route ids that are not UUIDs cannot exist, so they are a 404 rather than a validation error. */
export function parseId(value: string | undefined, what: string): string {
  if (!z.uuid().safeParse(value).success) throw notFound(what);
  return value as string;
}
