import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Pool settings from a connection URL. `sslmode` is handled here with libpq's meaning, because
 * node-postgres treats `require` as full certificate verification, which hosted databases behind
 * a pooler (e.g. Supabase) fail: `require` encrypts without verifying, `verify-full` verifies.
 */
export function poolConfig(connectionString: string): pg.PoolConfig {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get('sslmode');
  url.searchParams.delete('sslmode');
  const ssl =
    !sslmode || sslmode === 'disable'
      ? undefined
      : { rejectUnauthorized: sslmode === 'verify-ca' || sslmode === 'verify-full' };
  return { connectionString: url.toString(), ssl };
}

export function createPrismaClient(connectionString: string): PrismaClient {
  const pool = new pg.Pool(poolConfig(connectionString));
  // The pg adapter sends timestamps without an offset, which Postgres reads in the session time
  // zone. Pinning sessions to UTC makes stored instants correct regardless of the server's local
  // zone, and keeps them consistent with database-side now() and column defaults. A SET on each
  // new connection (queued before any other query) rather than a startup option, which
  // connection poolers such as Supabase's reject.
  pool.on('connect', (client) => {
    client.query("SET TIME ZONE 'UTC'").catch(() => undefined);
  });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

export type { PrismaClient };
