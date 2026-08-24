/**
 * Resolve websites for companies that have none, so the company assessment has
 * something real to judge. See lib/enrich.ts for why this is domain
 * construction rather than a search API.
 *
 * Writes companies.website only on a VERIFIED match. A wrong website is worse
 * than none: it feeds a confident wrong assessment.
 *
 * Usage: npx tsx scripts/enrich-websites.ts [--limit N] [--dry]
 */
import '../lib/loadenv';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { companies, runs } from '../lib/schema';
import { resolveWebsite } from '../lib/enrich';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

(async () => {
  const db = getDb();
  const limit = Number(arg('limit', '0'));
  const dry = process.argv.includes('--dry');

  const targets = await db.select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(and(
      eq(companies.discoveredVia, 'form_d'),
      eq(companies.scopeStatus, 'in_scope'),
      isNull(companies.website),
    ));
  const list = limit ? targets.slice(0, limit) : targets;
  console.log(`${list.length} companies without a website`);
  if (!list.length) return;

  const [run] = await db.insert(runs).values({ stage: 'enrich_web' }).returning();
  const counts = { attempted: 0, resolved: 0, unresolved: 0 };

  for (const c of list) {
    counts.attempted++;
    const r = await resolveWebsite(c.name);
    if (r) {
      counts.resolved++;
      console.log(`  ✓ ${c.name} -> ${r.domain}`);
      console.log(`      ${(r.description ?? r.title ?? '').slice(0, 100)}`);
      if (!dry) {
        // Store the site description so the assessment reads real copy rather
        // than a name. Prefixed so its provenance is obvious.
        const blurb = [r.title, r.description].filter(Boolean).join(' — ').slice(0, 500);
        await db.update(companies).set({
          website: r.domain,
          description: blurb ? `Website: ${blurb}` : undefined,
        }).where(eq(companies.id, c.id));
      }
    } else {
      counts.unresolved++;
      console.log(`  ✗ ${c.name}`);
    }
  }

  if (!dry) await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
  console.log('');
  console.table(counts);
})();
