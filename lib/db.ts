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

/**
 * Retry a database operation through transient network failures.
 *
 * Neon's HTTP endpoint intermittently returns "fetch failed" — seen in testing
 * 2026-08-21. It is a dropped connection, not a query error, and it succeeds on
 * retry. Long-running scripts must not die from one.
 */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const msg = (e as Error).message ?? '';
      const transient = /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(msg);
      if (!transient || i === tries - 1) throw e;
      const wait = 2 ** i * 1000;
      console.warn(`[db] transient error (${msg.slice(0, 60)}); retry ${i + 1}/${tries - 1} in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

export { schema };
