/**
 * Neon connection. Brief §3.
 *
 * Uses the HTTP driver: no persistent connection, which suits both serverless
 * page loads and short-lived GitHub Actions jobs, and avoids the Postgres
 * connection-limit failure mode listed in DEBUGGING.md §2.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import { env } from './env';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const sql = neon(env.databaseUrl());
    _db = drizzle(sql, { schema });
  }
  return _db;
}

/** Raw SQL escape hatch for the health queries in DEBUGGING.md §4. */
export function getSql() {
  return neon(env.databaseUrl());
}

export { schema };
