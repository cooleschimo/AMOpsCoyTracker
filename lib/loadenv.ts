/**
 * Env loader for scripts.
 *
 * dotenv's default entrypoint reads `.env` only. Next.js reads `.env.local`
 * automatically, so scripts must be told explicitly or they silently see no
 * config — which looks exactly like a missing credential.
 *
 * Precedence: real process env (CI) wins over .env.local (local dev).
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

for (const f of ['.env.local', '.env']) {
  const p = join(process.cwd(), f);
  if (existsSync(p)) config({ path: p, override: false });
}
