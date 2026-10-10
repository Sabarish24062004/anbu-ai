import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

export function createPrismaClient(connectionString: string): PrismaClient {
  // The pg adapter sends timestamps without an offset, which Postgres reads in the session time
  // zone. Pinning sessions to UTC makes stored instants correct regardless of the server's local
  // zone, and keeps them consistent with database-side now() and column defaults.
  const adapter = new PrismaPg({ connectionString, options: '-c TimeZone=UTC' });
  return new PrismaClient({ adapter });
}

export type { PrismaClient };
